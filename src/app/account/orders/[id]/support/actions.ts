"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { checkSupportRequestRateLimit } from "@/lib/rate-limit";
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

  // T93（F-002）：登入會員維度限流，擋 UI 重複點擊與 script 直呼灌爆
  // 店家信箱／support_request 表；放在 DB 查詢前，被限流的請求不耗 DB。
  const withinLimit = await checkSupportRequestRateLimit(user.id);
  if (!withinLimit) {
    return { ok: false, error: "操作過於頻繁，請稍後再試" };
  }

  // service role 重查訂單擁有權與狀態——不信任前端傳來的資格判斷
  const serviceRole = createServiceRoleClient();
  const { data: order, error: orderError } = await serviceRole
    .from("orders")
    .select("id, member_id, status")
    .eq("id", idResult.data)
    .maybeSingle();

  // §6：查詢失敗 ≠ 查無資料——DB 暫時性故障不可誤報成「找不到訂單」。
  if (orderError) {
    return { ok: false, error: "系統忙碌，請稍後再試" };
  }

  if (!order || order.member_id !== user.id) {
    return { ok: false, error: "找不到訂單" };
  }

  if (!canRequestSupport(order.status as OrderStatus)) {
    return { ok: false, error: "此訂單目前無法申請售後" };
  }

  // T93 同單去重：同訂單已有處理中案件（pending／in_progress）即拒新增，
  // 引導客人等候回覆或直接回信補充。check-then-act 在併發下非嚴格保證
  //（§6），但這裡防的是灌爆而非帳務不變式，上方限流已擋速率，可接受。
  const { data: existing, error: existingError } = await serviceRole
    .from("support_request")
    .select("id")
    .eq("order_id", order.id)
    .in("status", ["pending", "in_progress"])
    .limit(1);

  if (existingError) {
    return { ok: false, error: "系統忙碌，請稍後再試" };
  }
  if (existing && existing.length > 0) {
    return {
      ok: false,
      error: "此訂單已有處理中的申請，請等候回覆；如需補充，直接回覆確認信即可",
    };
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
