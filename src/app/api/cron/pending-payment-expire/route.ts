import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { transitionOrder, OrderTransitionRaceError } from "@/lib/order/state-machine";
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
  // T110 分歧防護：已收款（payment=paid）卻卡 pending_payment 的訂單被本支
  // 跳過取消的筆數——正常營運為 0，非 0 即代表 webhook 推進段曾 rollback。
  diverged: number;
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
    diverged: 0,
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

    // T110 分歧防護：批次撈出這批逾期候選中「已有 paid payment」的訂單。
    // webhook 先翻 payment=paid 再推進訂單（notify/route.ts），若推進段的
    // transition_order_status RPC 因 order_status_log 寫入失敗而 rollback，
    // 會留下 payment=paid／order=pending_payment 的分歧；主對帳迴圈以
    // payment.status='pending' 為鍵撈不到它，若這裡再把它當「逾期未付款」
    // 取消，就變成「錢收了、單卻取消」的靜默 P0。故取消前先排除已收款者，
    // 改為跳過＋error 告警，交 reconcile 的分歧兜底補推進、或人工結算。
    const candidateIds = (candidates ?? []).map((o) => o.id);
    const paidOrderIds = new Set<string>();
    if (candidateIds.length > 0) {
      const { data: paidPayments, error: paidError } = await serviceRole
        .from("payment")
        .select("order_id")
        .in("order_id", candidateIds)
        .eq("status", "paid");
      // fail-safe：無法確認哪些已收款時，寧可整批不取消（throw→500、隔日
      // 重跑），也不冒「把已收款訂單誤取消」的風險。
      if (paidError) {
        throw new Error(`paid-payment 分歧檢查失敗: ${paidError.message}`);
      }
      for (const p of paidPayments ?? []) paidOrderIds.add(p.order_id);
    }

    for (const order of candidates ?? []) {
      summary.checked += 1;

      if (paidOrderIds.has(order.id)) {
        // 已收款卻卡 pending_payment：分歧態，絕不取消。發 P0 告警交人工／
        // reconcile 兜底；正常營運不會走到這裡。
        summary.diverged += 1;
        console.error(
          "[pending-payment-expire] 已收款訂單卡 pending_payment，跳過取消（需結算）",
          { orderId: order.id },
        );
        Sentry.captureMessage(
          "pending-payment-expire: paid payment on pending_payment order — skipped cancel (T110 divergence)",
          { level: "error", extra: { orderId: order.id } },
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
