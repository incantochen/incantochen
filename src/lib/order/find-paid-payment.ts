import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// 「這筆訂單有沒有已收款的 payment」單一出處（select id）。消費者：取消守衛
// （transitionOrder pre-guard／post-cancel 再查）、webhook fallback 的冪等短路、
// 結帳付款頁發新號前的防呆。注意：issue-invoice 的探針形狀不同（select
// merchant_trade_no＋order by created_at 取最新），刻意不併入本 helper，避免為
// 湊單一出處而讓回傳型別長歪。原本各處手刻 `payment WHERE order_id=? AND
// status='paid'`（T67 記錄過的散落複本失同步模式），能共用的都收斂於此。
//
// 一律檢查 { error } 並在 error 時 throw（不吞）：查詢失敗 ≠ 查無資料——只看
// data 會把 DB 暫時性故障誤判成「沒有已付款」，害呼叫端（如取消守衛）誤放行。
// 呼叫端若需要「查不到就當沒有」的寬鬆語意，應自行 catch，而非讓本函式靜默。
export async function findPaidPayment(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await serviceRole
    .from("payment")
    .select("id")
    .eq("order_id", orderId)
    .eq("status", "paid")
    .maybeSingle();

  if (error) {
    throw new Error(`findPaidPayment failed: ${error.message}`);
  }
  return data ?? null;
}

// 退款存在性守衛（refundOrder，T47）用：「這筆訂單有沒有任何可退款的收款
// 記錄」——同時放行 paid（首次退款）與 refunded（重入／並發已翻走）。兩者都
// 查無才代表這張單從未收款成立、無從退起。與 findPaidPayment 形狀刻意分開：
// paid 有 partial unique index（uq_payment_one_paid_per_order）至多一筆，但
// refunded 無此約束、§5 重複付款可有多筆，故用 in()＋limit(1) 只問存在性
//（maybeSingle 在多筆 refunded 下會炸）。收斂 refund-order.ts 原本手刻的同款
// 探針（避免散落複本失同步，T67 教訓）。
export async function findRefundablePayment(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await serviceRole
    .from("payment")
    .select("id")
    .eq("order_id", orderId)
    .in("status", ["paid", "refunded"])
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`findRefundablePayment failed: ${error.message}`);
  }
  return data ?? null;
}
