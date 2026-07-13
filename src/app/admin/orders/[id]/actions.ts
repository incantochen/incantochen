"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { AdminActionResult } from "@/lib/admin/action-result";
import { logPiiAccess } from "@/lib/pii/audit";
import { sendOrderShippedNotification } from "@/lib/email/order-shipped-notification";
import { sendOnce } from "@/lib/notification/send-once";
import {
  transitionOrder,
  adminOverrideStatus,
  OrderTransitionRaceError,
  type OrderStatus,
} from "@/lib/order/state-machine";
import {
  adminSupportCaseSchema,
  type AdminSupportCaseValues,
} from "@/lib/support/schema";
import type { SupportRequestStatus } from "@/lib/support/support-request";
import { REFRESH_TO_RETRY_SUFFIX } from "@/lib/concurrency-message";

// transitionOrder 的 CAS 守衛（T66）代表狀態轉換現在可能因為別的流程（cron
// 自動取消、ECPay webhook）搶先動過而失敗。這種情況不是操作失敗，是頁面顯示
// 的狀態已經過期。回傳契約（結構化 { ok, error }）的緣由見 action-result.ts。
export type { AdminActionResult };

const RACE_MESSAGE = `此訂單狀態已被其他流程異動${REFRESH_TO_RETRY_SUFFIX}`;

export async function changeStatus(
  orderId: string,
  to: OrderStatus,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  try {
    await transitionOrder(orderId, to, { actorId: user.id });
  } catch (e) {
    if (e instanceof OrderTransitionRaceError) {
      return { ok: false, error: RACE_MESSAGE };
    }
    return { ok: false, error: "狀態更新失敗，請稍後再試" };
  }
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function shipOrder(
  orderId: string,
  trackingNo: string,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("orders")
    .update({ tracking_no: trackingNo })
    .eq("id", orderId);

  if (error) {
    return { ok: false, error: "更新物流單號失敗，請稍後再試" };
  }

  try {
    await transitionOrder(orderId, "shipped", {
      actorId: user.id,
      note: `出貨：${trackingNo}`,
    });
  } catch (e) {
    if (e instanceof OrderTransitionRaceError) {
      return { ok: false, error: RACE_MESSAGE };
    }
    return { ok: false, error: "出貨標記失敗，請稍後再試" };
  }

  // 出貨這件事本身已經成功寫入 DB，寄信只是 best-effort 通知：sendOnce 保證
  // 絕不往外拋例外（不擋出貨操作），且用 notification(order_id, type) 的
  // unique 約束去重——雙擊出貨按鈕不會重複寄信。
  await sendOnce(supabase, {
    orderId,
    type: "order_shipped",
    send: () => sendOrderShippedNotification(orderId),
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function overrideStatus(
  orderId: string,
  to: OrderStatus,
  reason: string,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  try {
    await adminOverrideStatus(orderId, to, { operatorId: user.id, reason });
  } catch (e) {
    if (e instanceof OrderTransitionRaceError) {
      return { ok: false, error: RACE_MESSAGE };
    }
    return { ok: false, error: "強制改狀態失敗，請稍後再試" };
  }
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function revealOrderPii(orderId: string): Promise<{
  recipientName: string;
  recipientPhone: string;
  email: string | null;
  shippingAddress: string;
}> {
  const user = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("recipient_name, recipient_phone, shipping_address, member(email)")
    .eq("id", orderId)
    .single();

  if (error || !order) throw new Error("找不到訂單");

  // 完整個資離開伺服器前必記稽核 log（T64/T80）；寫入失敗 fail closed，不回傳 PII
  await logPiiAccess({
    actorId: user.id,
    actorEmail: user.email ?? "",
    orderId,
    fields: ["recipient_name", "recipient_phone", "email", "shipping_address"],
  });

  const member = order.member as { email: string } | null;
  return {
    recipientName: order.recipient_name,
    recipientPhone: order.recipient_phone,
    email: member?.email ?? null,
    shippingAddress: order.shipping_address,
  };
}

export async function saveTrackingNo(orderId: string, trackingNo: string) {
  await requireAdmin();
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("orders")
    .update({ tracking_no: trackingNo })
    .eq("id", orderId);

  if (error) throw new Error(`更新物流單號失敗：${error.message}`);
  revalidatePath(`/admin/orders/${orderId}`);
}

const SUPPORT_STATUSES: SupportRequestStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "rejected",
];

export async function updateSupportRequestStatus(
  requestId: string,
  status: SupportRequestStatus,
) {
  await requireAdmin();
  if (!SUPPORT_STATUSES.includes(status)) throw new Error("不合法的狀態");

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("support_request")
    .update({ status })
    .eq("id", requestId)
    .select("order_id")
    .single();

  if (error || !data) throw new Error("更新售後申請狀態失敗");

  revalidatePath(`/admin/orders/${data.order_id}`);
  revalidatePath(`/account/orders/${data.order_id}`);
  revalidatePath(`/account/orders/${data.order_id}/support`);
}

export async function createSupportCaseByAdmin(
  orderId: string,
  values: AdminSupportCaseValues,
) {
  await requireAdmin();

  const result = adminSupportCaseSchema.safeParse(values);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "表單格式不正確");
  }

  const supabase = createServiceRoleClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("member_id")
    .eq("id", orderId)
    .single();

  if (orderError || !order) throw new Error("找不到訂單");

  // 店家自己登錄的案件，不寄店家通知信
  const { error } = await supabase.from("support_request").insert({
    order_id: orderId,
    member_id: order.member_id,
    request_type: result.data.requestType,
    description: result.data.description,
  });

  if (error) throw new Error("建立售服案件失敗");

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/account/orders/${orderId}`);
  revalidatePath(`/account/orders/${orderId}/support`);
}
