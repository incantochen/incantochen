import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  transitionOrder,
  OrderTransitionRaceError,
  PaidOrderCancelBlockedError,
} from "@/lib/order/state-machine";
import { requireCronAuth } from "@/lib/cron/require-cron-auth";

// serverless function 最長執行時間：整批候選逐筆 transitionOrder（含守衛查詢）
// ＋pending payment sweep，最壞情況遠低於此，設 300s 純為避免平台預設過低時
// 中途被砍（比照 reconcile route）。
export const maxDuration = 300;

const PENDING_PAYMENT_TTL_MS = 72 * 60 * 60 * 1000;
// 比照 ecpay-reconcile 的 CANDIDATE_LIMIT：避免首次上線 backlog 或排程中斷
// 數日後單次處理過大範圍；超過上限留給隔天同一支 cron 接著處理。
const EXPIRE_BATCH_LIMIT = 50;

type Summary = {
  checked: number;
  cancelled: number;
  skipped: number;
  failed: number;
  // 候選訂單已有 paid payment（webhook 側卡單漂移），取消被 transitionOrder
  // 守衛擋下的筆數（T127①）。TOCTOU 窄窗的偵測與告警已下沉到 transitionOrder
  // （取消後再查），本 summary 不再單獨計 paidAfterCancel。
  paidConflict: number;
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

    for (const order of candidates ?? []) {
      summary.checked += 1;

      try {
        // 取消守衛（有 paid payment 就不准取消）與 TOCTOU 偵測都下沉在
        // transitionOrder 內。webhook 側卡單會在守衛處被擋下 →
        // PaidOrderCancelBlockedError；此處只負責計數＋告警，實際自癒交給
        // reconcile 漂移臂隔日冪等推進。
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
        if (e instanceof PaidOrderCancelBlockedError) {
          // webhook 側卡單：錢已收、訂單還在 pending_payment，守衛擋下取消。
          // P0 告警——這筆由 reconcile 漂移臂隔日自癒。
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
