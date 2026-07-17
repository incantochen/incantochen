import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// 把某訂單所有 pending payment 標成 failed 的單一出處（逾期取消 cron 取消後、
// reconcile 漂移臂推進後共用）：死掉／已由別筆付清的 pending row 若不清掉，會
// 每天被主對帳臂的候選集撈到（TradeStatus=0→不動作→又蓋章→隔日再撈），永遠
// 佔一個 slot＋一次 ECPay 查詢。失敗只告警（warning），不影響呼叫端主流程。
//
// ⚠️ 已知侷限（設計取捨，非本函式可獨力解）：若同一訂單真有第二筆「客人仍在
// 綠界付款中」的 pending payment，這裡會把它一併標 failed。實務上 pay page 建
// 新付款連結前會先把舊 pending 標 failed（同一訂單同時只留一筆 pending），故
// 正常流程不會出現兩筆並行 in-flight；真正並行（多分頁同時付）屬罕見多重下單
// 情境，且 uq_payment_one_paid_per_order 已保證同訂單至多一筆 paid。若日後開放
// 多筆並行付款，需改以 payment.id 精準鎖定，而非「該訂單所有 pending」。
export async function markPendingPaymentsFailed(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
) {
  const { error } = await serviceRole
    .from("payment")
    .update({ status: "failed" })
    .eq("order_id", orderId)
    .eq("status", "pending");
  if (error) {
    Sentry.captureMessage("payment: mark-pending-failed sweep failed", {
      level: "warning",
      extra: { orderId, error: error.message },
    });
  }
}
