import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { type OrderStatus, VALID_TRANSITIONS } from "@/lib/order/order-status";

export type { OrderStatus };
export { VALID_TRANSITIONS };

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// 正常流程：受狀態機約束。
// 讀取現有狀態 → canTransition 驗證 → UPDATE orders → INSERT order_status_log。
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  options?: { note?: string; actorId?: string },
): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) {
    throw new Error(`訂單不存在：${orderId}`);
  }

  const from = order.status as OrderStatus;

  if (!canTransition(from, to)) {
    throw new Error(`非法狀態轉換：${from} → ${to}`);
  }

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", from)
    .select("id")
    .maybeSingle();

  if (updateError) throw new Error(`訂單狀態更新失敗：${updateError.message}`);
  if (!updated) {
    throw Object.assign(new Error(`訂單狀態已被其他流程異動：${orderId}`), {
      code: "STALE_TRANSITION",
    });
  }

  const { error: logError } = await supabase.from("order_status_log").insert({
    order_id: orderId,
    from_status: from,
    to_status: to,
    note: options?.note ?? null,
    actor_id: options?.actorId ?? null,
    is_override: false,
  });

  if (logError) throw new Error(`狀態 log 寫入失敗：${logError.message}`);
}

// Admin override：繞過狀態機，可將訂單改為任意狀態。
// operatorId（member.id）與 reason 必填，確保稽核記錄完整。
export async function adminOverrideStatus(
  orderId: string,
  to: OrderStatus,
  options: { operatorId: string; reason: string },
): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) {
    throw new Error(`訂單不存在：${orderId}`);
  }

  const from = order.status as OrderStatus;

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", orderId);

  if (updateError) throw new Error(`訂單狀態更新失敗：${updateError.message}`);

  const { error: logError } = await supabase.from("order_status_log").insert({
    order_id: orderId,
    from_status: from,
    to_status: to,
    note: options.reason,
    actor_id: options.operatorId,
    is_override: true,
  });

  if (logError) throw new Error(`稽核 log 寫入失敗：${logError.message}`);
}
