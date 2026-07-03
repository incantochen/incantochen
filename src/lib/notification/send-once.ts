import "server-only";
import { randomUUID } from "crypto";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";

type ServiceRole = ReturnType<typeof createServiceRoleClient>;

// notification(order_id, type) 有 unique constraint（T69）：
// insert 先佔位 status='pending'，send() 完成才回填 sent/failed，
// 避免「insert 成功但送信失敗」被誤判為已寄出、之後 webhook 重送也不會再試。
export async function sendOnce(
  serviceRole: ServiceRole,
  params: { orderId: string; type: string; send: () => Promise<void> },
): Promise<void> {
  const { orderId, type, send } = params;
  const id = randomUUID();

  const { error: insertError } = await serviceRole.from("notification").insert({
    id,
    order_id: orderId,
    channel: "email",
    type,
    status: "pending",
  });

  if (!insertError) return attemptSend(serviceRole, id, send);

  if (insertError.code !== "23505") {
    console.error("[notification] insert failed", type, insertError);
    return;
  }

  // 已有紀錄（本次或前次嘗試留下的）：只有 failed 才重試，sent/pending 一律跳過
  const { data: existing } = await serviceRole
    .from("notification")
    .select("id, status")
    .eq("order_id", orderId)
    .eq("type", type)
    .maybeSingle();

  if (!existing || existing.status !== "failed") return;
  return attemptSend(serviceRole, existing.id, send);
}

async function attemptSend(
  serviceRole: ServiceRole,
  notificationId: string,
  send: () => Promise<void>,
): Promise<void> {
  try {
    await send();
    await serviceRole
      .from("notification")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", notificationId);
  } catch (e) {
    console.error("[notification] send failed", e);
    await serviceRole
      .from("notification")
      .update({ status: "failed" })
      .eq("id", notificationId);
  }
}
