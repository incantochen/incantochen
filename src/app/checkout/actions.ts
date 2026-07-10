"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { findOrCreateMember } from "@/lib/auth/find-or-create-member";
import {
  checkoutFormSchema,
  type CheckoutFormValues,
} from "@/lib/checkout/schema";
import { verifyCartPrices } from "@/lib/quote/verify-prices";
import { touchCartUpdatedAt } from "@/lib/cart/touch-cart-updated-at";

type CreateOrderResult = {
  ok: false;
  error: string;
  priceUpdated?: true;
  requiresLogin?: true;
};

// T71：訪客 email 命中既有會員或建號時撞號，兩處回傳同一段文字與結果物件，
// 避免兩處文案手改後失去同步（不宣稱完全杜絕帳號枚舉——requiresLogin 本身
// 仍會透露該 email 已註冊；殘留風險見 PR 說明）。
const REQUIRES_LOGIN_RESULT: CreateOrderResult = {
  ok: false,
  error: "這個 email 需要先登入才能結帳，請登入後重新送出訂單",
  requiresLogin: true,
};

function generateOrderNo(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid confusable chars
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `INC-${date}-${suffix}`;
}

export async function createOrder(
  formData: CheckoutFormValues,
): Promise<CreateOrderResult> {
  // ① Server-side schema validation
  const parsed = checkoutFormSchema.safeParse(formData);
  if (!parsed.success) {
    return { ok: false, error: "表單資料有誤，請重新填寫" };
  }
  const { recipientName, recipientPhone, zipCode, shippingAddress } =
    parsed.data;
  // T71：比照 login/actions.ts 正規化，避免大小寫變體繞過既有會員比對。
  const email = parsed.data.email.trim().toLowerCase();

  const serviceRole = createServiceRoleClient();
  const cookieStore = await cookies();
  const guestToken = cookieStore.get("guest_token")?.value;

  // ② Read cart (service role — RLS blocks all direct reads)
  if (!guestToken) {
    return { ok: false, error: "購物車已空，請重新加入商品" };
  }

  const { data: cart } = await serviceRole
    .from("cart")
    .select("id")
    .eq("guest_token", guestToken)
    .maybeSingle();

  if (!cart) {
    return { ok: false, error: "購物車已空，請重新加入商品" };
  }

  const { data: cartItems } = await serviceRole
    .from("cart_item")
    .select("id, product_id, quantity, unit_price_snapshot, config_snapshot")
    .eq("cart_id", cart.id);

  if (!cartItems || cartItems.length === 0) {
    return { ok: false, error: "購物車已空，請重新加入商品" };
  }

  // ③ Member find-or-create ("結帳即會員")
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let memberId: string;

  if (user) {
    // Already logged in — ensure member row exists
    await findOrCreateMember(user.id, user.email ?? email);
    memberId = user.id;
  } else {
    // Guest checkout: find or create member by email
    const { data: existingMember } = await serviceRole
      .from("member")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingMember) {
      // T71：訪客未經驗證，不能直接把訂單掛到既有會員身上——要求先登入。
      return REQUIRES_LOGIN_RESULT;
    }

    const { data: newAuthData, error: createError } =
      await serviceRole.auth.admin.createUser({
        email,
        email_confirm: true,
      });
    if (createError || !newAuthData.user) {
      if (createError?.message?.toLowerCase().includes("already")) {
        return REQUIRES_LOGIN_RESULT;
      }
      return { ok: false, error: "建立會員失敗，請稍後再試" };
    }
    await findOrCreateMember(newAuthData.user.id, email);
    memberId = newAuthData.user.id;
  }

  // ④ Server-side price re-verification (T41 安全紅線：絕不信任 cart 快照價)
  let verifiedItems;
  try {
    verifiedItems = await verifyCartPrices(serviceRole, cartItems);
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "商品資訊有誤，請重新確認後再試";
    return { ok: false, error: msg };
  }

  // ④-b 若任何品項金額有變動：更新 cart 快照、提示使用者確認新金額後再送出
  // （對齊 user-flow.md R/S/Q loop：不靜默建單，讓客人看到新金額再確認）
  const changedItems = verifiedItems.filter((item) => item.priceChanged);
  if (changedItems.length > 0) {
    await Promise.all(
      changedItems.map((item) =>
        serviceRole
          .from("cart_item")
          .update({
            unit_price_snapshot: item.verifiedUnitPrice,
            config_snapshot: item.configSnapshot,
          })
          .eq("id", item.cartItemId),
      ),
    );
    await touchCartUpdatedAt(serviceRole, cart.id);
    revalidatePath("/cart");
    revalidatePath("/checkout");
    return {
      ok: false,
      error: "商品金額已更新，請確認新金額後再次送出",
      priceUpdated: true,
    };
  }

  // ④ Calculate amounts from verified prices
  const subtotal = verifiedItems.reduce(
    (sum, item) => sum + item.verifiedUnitPrice * item.quantity,
    0,
  );
  const shippingFee = 0; // T48 暫緩
  const totalAmount = subtotal + shippingFee;

  // ⑤⑥ Insert order (retry once on order_no collision)
  async function insertOrder(no: string) {
    return serviceRole
      .from("orders")
      .insert({
        member_id: memberId,
        order_no: no,
        status: "pending_payment",
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        zip_code: zipCode,
        shipping_address: shippingAddress,
        subtotal,
        shipping_fee: shippingFee,
        total_amount: totalAmount,
        custom_consent: true,
        consent_at: new Date().toISOString(),
      })
      .select("id")
      .single();
  }

  let orderNo = generateOrderNo();
  const firstAttempt = await insertOrder(orderNo);
  let order = firstAttempt.data;
  const orderError = firstAttempt.error;

  if (orderError || !order) {
    if (orderError?.code === "23505") {
      // order_no collision — retry with a new number
      orderNo = generateOrderNo();
      const retry = await insertOrder(orderNo);
      if (retry.error || !retry.data) {
        return { ok: false, error: "建立訂單失敗，請稍後再試" };
      }
      order = retry.data;
    } else {
      return { ok: false, error: "建立訂單失敗，請稍後再試" };
    }
  }

  const orderId = order.id;

  // ⑦ Insert order_items (use server-verified prices, not raw cart snapshots)
  const orderItems = verifiedItems.map((item) => ({
    order_id: orderId,
    product_id: item.productId,
    product_name_snapshot: item.productName,
    quantity: item.quantity,
    unit_price_snapshot: item.verifiedUnitPrice,
    config_snapshot: item.configSnapshot,
  }));

  const { error: itemsError } = await serviceRole
    .from("order_item")
    .insert(orderItems);

  if (itemsError) {
    // Order exists but items failed — return error; admin can clean up orphaned order
    return {
      ok: false,
      error: "訂單明細寫入失敗，請聯絡客服（訂單號：" + orderNo + "）",
    };
  }

  // ⑧ Clear cart (CASCADE deletes cart_items)
  await serviceRole.from("cart").delete().eq("id", cart.id);

  // ⑨ Redirect to payment page
  redirect(`/checkout/pay?order=${orderNo}`);
}
