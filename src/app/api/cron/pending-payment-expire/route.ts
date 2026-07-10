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
};

// T66：待付款訂單逾期（72 小時，以 orders.created_at 為固定時鐘，不因重新產生
// 付款連結而延長）自動取消。與 ECPay webhook / T89 對帳共用同一批候選訂單，
// 故 transitionOrder 的 CAS 守衛（.eq("status", from)）是本支能安全跑的前提——
// 沒有它，cron 判定「還是 pending_payment」的同時 webhook 剛把它轉成 paid，
// 會把 paid 蓋回 cancelled。
export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const summary: Summary = { checked: 0, cancelled: 0, skipped: 0, failed: 0 };

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
        await transitionOrder(order.id, "cancelled", {
          note: "逾期未付款自動取消",
        });
        summary.cancelled += 1;
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
