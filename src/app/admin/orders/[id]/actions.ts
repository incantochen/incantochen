"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logPiiAccess } from "@/lib/pii/audit";
import {
  transitionOrder,
  adminOverrideStatus,
  type OrderStatus,
} from "@/lib/order/state-machine";
import {
  adminSupportCaseSchema,
  type AdminSupportCaseValues,
} from "@/lib/support/schema";
import type { SupportRequestStatus } from "@/lib/support/support-request";

export async function changeStatus(orderId: string, to: OrderStatus) {
  const user = await requireAdmin();
  await transitionOrder(orderId, to, { actorId: user.id });
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
}

export async function shipOrder(orderId: string, trackingNo: string) {
  const user = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("orders")
    .update({ tracking_no: trackingNo })
    .eq("id", orderId);

  if (error) throw new Error(`更新物流單號失敗：${error.message}`);

  await transitionOrder(orderId, "shipped", {
    actorId: user.id,
    note: `出貨：${trackingNo}`,
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
}

export async function overrideStatus(
  orderId: string,
  to: OrderStatus,
  reason: string,
) {
  const user = await requireAdmin();
  await adminOverrideStatus(orderId, to, { operatorId: user.id, reason });
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
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

  // 完整個資離開伺服器前必記稽核 log（T64：記錄誰存取個資）
  logPiiAccess({
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
