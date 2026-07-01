"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  transitionOrder,
  adminOverrideStatus,
  type OrderStatus,
} from "@/lib/order/state-machine";

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
  reason: string
) {
  const user = await requireAdmin();
  await adminOverrideStatus(orderId, to, { operatorId: user.id, reason });
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
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
