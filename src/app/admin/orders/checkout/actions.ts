"use server";
import "server-only";

import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { findOrCreateMemberByEmail } from "@/lib/auth/find-or-create-member";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import {
  checkoutFormSchema,
  type CheckoutFormValues,
} from "@/lib/checkout/schema";
import {
  createOrderFromCart,
  resolvePendingOrderForCart,
} from "@/lib/order/create-order-from-cart";
import { serverEnv } from "@/lib/env.server";

type CreateAdminOrderResult =
  | { ok: true; orderNo: string; paymentLink: string }
  | { ok: false; error: string; priceUpdated?: true };

function buildPaymentLink(orderNo: string): string {
  const paymentUrl = new URL("/checkout/pay", serverEnv.NEXT_PUBLIC_SITE_URL);
  paymentUrl.searchParams.set("order", orderNo);
  return paymentUrl.toString();
}

export async function createAdminOrderFromCart(
  formData: CheckoutFormValues,
): Promise<CreateAdminOrderResult> {
  await requireAdmin();

  const parsed = checkoutFormSchema.safeParse(formData);
  if (!parsed.success) {
    return { ok: false, error: "表單資料有誤，請重新填寫" };
  }
  const { recipientName, recipientPhone, zipCode, shippingAddress } =
    parsed.data;
  const email = normalizeEmail(parsed.data.email);

  const serviceRole = createServiceRoleClient();
  const cookieStore = await cookies();
  const guestToken = cookieStore.get("guest_token")?.value;

  if (!guestToken) {
    return { ok: false, error: "購物袋是空的，請先到商品頁加入商品" };
  }

  // §6：查詢失敗 ≠ 查無資料——DB 暫時性故障不可誤判成「購物袋是空的」。
  const { data: cart, error: cartError } = await serviceRole
    .from("cart")
    .select("id, updated_at")
    .eq("guest_token", guestToken)
    .maybeSingle();

  if (cartError) {
    return { ok: false, error: "讀取購物袋失敗，請稍後再試" };
  }
  if (!cart) {
    return { ok: false, error: "購物袋是空的，請先到商品頁加入商品" };
  }
  const cartId = cart.id;

  const { data: cartItems, error: cartItemsError } = await serviceRole
    .from("cart_item")
    .select("id, product_id, quantity, unit_price_snapshot, config_snapshot")
    .eq("cart_id", cartId);

  if (cartItemsError) {
    return { ok: false, error: "讀取購物袋失敗，請稍後再試" };
  }
  if (!cartItems || cartItems.length === 0) {
    return { ok: false, error: "購物袋是空的，請先到商品頁加入商品" };
  }

  const memberResult = await findOrCreateMemberByEmail(email);
  if (!memberResult.ok) {
    return { ok: false, error: memberResult.error };
  }
  const memberId = memberResult.memberId;

  // Pending 訂單 dedup——帶 memberId 比對：admin 打錯 email 後改正重送同一張
  // cart 時，舊單掛在錯誤會員下，必須取消重建，絕不能沿用其付款連結。同時
  // 帶收件資訊比對：admin 改地址錯字重送時同樣要取消重建，不能沿用舊地址。
  const pending = await resolvePendingOrderForCart(
    serviceRole,
    cartId,
    cart.updated_at,
    { recipientName, recipientPhone, zipCode, shippingAddress },
    memberId,
  );
  if (pending.kind === "error") {
    return { ok: false, error: pending.error };
  }
  if (pending.kind === "reuse") {
    return {
      ok: true,
      orderNo: pending.orderNo,
      paymentLink: buildPaymentLink(pending.orderNo),
    };
  }

  const result = await createOrderFromCart(
    serviceRole,
    cartId,
    cartItems,
    memberId,
    {
      recipientName,
      recipientPhone,
      zipCode,
      shippingAddress,
    },
  );

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    orderNo: result.orderNo,
    paymentLink: buildPaymentLink(result.orderNo),
  };
}
