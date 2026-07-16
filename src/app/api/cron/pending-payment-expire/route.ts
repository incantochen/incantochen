import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  transitionOrder,
  OrderTransitionRaceError,
} from "@/lib/order/state-machine";
import { requireCronAuth } from "@/lib/cron/require-cron-auth";

const PENDING_PAYMENT_TTL_MS = 72 * 60 * 60 * 1000;
// 比照 ecpay-reconcile 的 CANDIDATE_LIMIT：避免首次上線 backlog 或排程中斷
// 數日後單次處理過大範圍；超過上限留給隔天同一支 cron 接著處理。
const EXPIRE_BATCH_LIMIT = 50;

type Summary = {
  checked: number;
  cancelled: number;
  skipped: number;
  failed: number;
  // T127①：候選訂單已有 paid payment（webhook 側卡單漂移），取消被擋下的筆數。
  paidConflict: number;
  // TOCTOU 補洞：取消後才發現 payment 已 paid（快照後、cancel 前的窄窗競態）
  // ——錢收在剛被取消的訂單上，走 §6.1 人工裁決。
  paidAfterCancel: number;
};

// T66：待付款訂單逾期（72 小時，以 orders.created_at 為固定時鐘，不因重新產生
// 付款連結而延長）自動取消。與 ECPay webhook / T89 對帳共用同一批候選訂單，
// 故 transitionOrder 的 CAS 守衛（.eq("status", from)）是本支能安全跑的前提——
// 沒有它，cron 判定「還是 pending_payment」的同時 webhook 剛把它轉成 paid，
// 會把 paid 蓋回 cancelled。
export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const summary: Summary = {
    checked: 0,
    cancelled: 0,
    skipped: 0,
    failed: 0,
    paidConflict: 0,
    paidAfterCancel: 0,
  };

  try {
    const serviceRole = createServiceRoleClient();
    const cutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MS).toISOString();

    const { data: candidates, error } = await serviceRole
      .from("orders")
      .select("id")
      .eq("status", "pending_payment")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(EXPIRE_BATCH_LIMIT);

    if (error) throw new Error(`候選查詢失敗: ${error.message}`);

    // T127①：取消前先確認候選訂單沒有 paid payment。webhook 側卡單（payment
    // 已 paid、訂單卡 pending_payment，見 ops-runbook §1.1 第④類）的錢已經
    // 收到，絕不可被逾期取消——這種漂移交給 ecpay-reconcile 的漂移臂（T127②）
    // 隔日冪等推進。一次批次查詢，避免逐筆 round-trip。
    const candidateIds = (candidates ?? []).map((o) => o.id);
    const paidOrderIds = new Set<string>();
    if (candidateIds.length > 0) {
      const { data: paidPayments, error: paidQueryError } = await serviceRole
        .from("payment")
        .select("order_id")
        .in("order_id", candidateIds)
        .eq("status", "paid");

      if (paidQueryError) {
        // fail-safe：無法確認「有沒有已收款」就整批不取消——寧可晚一天取消，
        // 不可誤取消已付款訂單（取消不可逆、且會觸發 T66 生命週期後續）。
        // 作法沿用上方候選查詢的 throw：走外層 catch＝Sentry captureException
        // ＋HTTP 500。刻意不回 200／不動 failed 計數——回 200 會讓 Vercel cron
        // 監控（以 HTTP 狀態判健康）把「整批被跳過」誤看成綠燈，且把 failed 的
        // 語意從「單筆 transition 失敗」污染成「整批未檢查」，破壞
        // cancelled+skipped+failed+paidConflict ≤ checked 不變式。
        throw new Error(
          `paid-payment guard 查詢失敗: ${paidQueryError.message}`,
        );
      }
      for (const p of paidPayments ?? []) paidOrderIds.add(p.order_id);
    }

    for (const order of candidates ?? []) {
      summary.checked += 1;

      if (paidOrderIds.has(order.id)) {
        // webhook 側卡單：錢已收、訂單還在 pending_payment。skip 取消（連帶
        // 不掃 payment），P0 告警——這筆由 reconcile 漂移臂（T127②）自癒。
        // 殘餘競態（本批次查詢之後、cancel 之前 webhook 才翻 paid）由取消後
        // 的 post-cancel paid 再查（見下方）補偵測，不在這裡加鎖。
        summary.paidConflict += 1;
        Sentry.captureMessage(
          "pending-payment-expire: paid payment exists on expiring order, skip cancel (webhook-side stuck order)",
          {
            level: "error",
            extra: { orderId: order.id },
          },
        );
        continue;
      }

      try {
        await transitionOrder(order.id, "cancelled", {
          note: "逾期未付款自動取消",
        });
        summary.cancelled += 1;

        // 訂單取消後順手把它的 pending payment 標成 failed：否則這些死掉的
        // pending row 會永遠留在 ecpay-reconcile 的候選清單裡（依 created_at
        // 升序排最前面），累積約 30 筆就把每日對帳批次整批塞滿，真正卡住的
        // 新付款反而輪不到檢查。失敗只告警，不影響取消本身。
        const { error: paymentSweepError } = await serviceRole
          .from("payment")
          .update({ status: "failed" })
          .eq("order_id", order.id)
          .eq("status", "pending");
        if (paymentSweepError) {
          Sentry.captureMessage(
            "pending-payment-expire: payment sweep failed",
            {
              level: "warning",
              extra: { orderId: order.id, error: paymentSweepError.message },
            },
          );
        }

        // post-cancel paid 再查（T127① 的 TOCTOU 補洞）：批次快照之後、cancel
        // 之前 webhook 才翻 payment=paid、且該次 ensureOrderPaid 失敗＋ECPay
        // 重送恰好耗盡的窄窗，會產生「payment=paid／orders=cancelled」——主對帳
        // 臂（鍵 payment=pending）與漂移臂（鍵 orders=pending_payment）都撈不
        // 到、之後也沒有 webhook 會再來觸發 closed 告警＝完全無聲。取消「之後」
        // 再查一次即完備：flip 在查之前→這裡抓到；flip 在查之後→同一次 webhook
        // 呼叫接著跑 ensureOrderPaid 必撞 cancelled→closed P0（兩訊號互補，
        // 無縫隙）。偵測即可（修復走 ops-runbook §6.1 人工裁決，同第⑤類）；
        // 查詢失敗只降級告警，不影響已完成的取消。
        const { data: paidAfter, error: paidAfterError } = await serviceRole
          .from("payment")
          .select("id")
          .eq("order_id", order.id)
          .eq("status", "paid")
          .maybeSingle();
        if (paidAfterError) {
          Sentry.captureMessage(
            "pending-payment-expire: post-cancel paid check failed",
            {
              level: "warning",
              extra: { orderId: order.id, error: paidAfterError.message },
            },
          );
        } else if (paidAfter) {
          summary.paidAfterCancel += 1;
          Sentry.captureMessage(
            "pending-payment-expire: money received on order cancelled this run (race window), manual adjudication required",
            {
              level: "error",
              extra: { orderId: order.id },
            },
          );
        }
      } catch (e) {
        // webhook 剛好搶先把訂單轉成 paid（或轉成其他任何非 pending_payment
        // 狀態）：不論是敗在 CAS 守衛還是更早的 canTransition 檢查，都是候選
        // 查詢之後才發生的良性競態，不算錯誤、不進 Sentry（否則每次良性競態
        // 都會誤觸告警噪音）。
        if (e instanceof OrderTransitionRaceError) {
          summary.skipped += 1;
          continue;
        }
        summary.failed += 1;
        Sentry.captureException(e, { extra: { orderId: order.id } });
      }
    }

    return Response.json(summary);
  } catch (e) {
    console.error("[pending-payment-expire] unhandled error", e);
    Sentry.captureException(e);
    return Response.json(summary, { status: 500 });
  }
}
