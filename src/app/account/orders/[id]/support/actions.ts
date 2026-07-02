"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendSupportRequestNotification } from "@/lib/email/support-request-notification";
import { supportRequestFormSchema } from "@/lib/support/schema";
import { canRequestSupport } from "@/lib/support/support-request";
import type { OrderStatus } from "@/lib/order/order-status";

type ActionResult = { ok: true } | { ok: false; error: string };

const orderIdSchema = z.string().uuid();

export async function createSupportRequest(
  orderId: string,
  values: { description: string },
): Promise<ActionResult> {
  const user = await requireUser();

  const idResult = orderIdSchema.safeParse(orderId);
  if (!idResult.success) {
    return { ok: false, error: "訂單編號格式不正確" };
  }

  const formResult = supportRequestFormSchema.safeParse(values);
  if (!formResult.success) {
    return {
      ok: false,
      error: formResult.error.issues[0]?.message ?? "說明格式不正確",
    };
  }

  // service role 重查訂單擁有權與狀態——不信任前端傳來的資格判斷
  const serviceRole = createServiceRoleClient();
  const { data: order } = await serviceRole
    .from("orders")
    .select("id, member_id, status")
    .eq("id", idResult.data)
    .maybeSingle();

  if (!order || order.member_id !== user.id) {
    return { ok: false, error: "找不到訂單" };
  }

  if (!canRequestSupport(order.status as OrderStatus)) {
    return { ok: false, error: "此訂單目前無法申請售後" };
  }

  const { data: inserted, error } = await serviceRole
    .from("support_request")
    .insert({
      order_id: order.id,
      member_id: user.id,
      request_type: "return_defect",
      description: formResult.data.description,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, error: "送出失敗，請稍後再試" };
  }

  // 刻意 await＋吞錯：email 是通知店家唯一出口，失敗不擋申請（DB 已有紀錄可人工補救）
  try {
    await sendSupportRequestNotification(inserted.id);
  } catch {
    // no-op
  }

  revalidatePath(`/account/orders/${order.id}`);
  revalidatePath(`/account/orders/${order.id}/support`);

  return { ok: true };
}
