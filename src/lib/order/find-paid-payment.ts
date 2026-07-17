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
