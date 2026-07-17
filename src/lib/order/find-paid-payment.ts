import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// 「這筆訂單有沒有已收款的 payment」單一出處。原本 pay page／webhook fallback／
// issue-invoice／逾期取消 cron 各自手刻 `payment WHERE order_id=? AND status='paid'`
// 探針（T67 記錄過的散落複本失同步模式），收斂於此供 import。
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
