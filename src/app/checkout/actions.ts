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
import { verifyCartPrices, type VerifiedItem } from "@/lib/quote/verify-prices";
import { touchCartUpdatedAt } from "@/lib/cart/touch-cart-updated-at";

type CreateOrderResult = { ok: false; error: string; priceUpdated?: true };

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
  const { email, recipientName, recipientPhone, zipCode, shippingAddress } =
    parsed.data;

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
  const cartId = cart.id;

  const { data: cartItems } = await serviceRole
    .from("cart_item")
    .select("id, product_id, quantity, unit_price_snapshot, config_snapshot")
    .eq("cart_id", cartId);

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
      memberId = existingMember.id;
    } else {
      const { data: newAuthData, error: createError } =
        await serviceRole.auth.admin.createUser({
          email,
          email_confirm: true,
        });
      if (createError || !newAuthData.user) {
        if (createError?.message?.toLowerCase().includes("already")) {
          return { ok: false, error: "此 Email 已有帳號，請先登入再結帳" };
        }
        return { ok: false, error: "建立會員失敗，請稍後再試" };
      }
      await findOrCreateMember(newAuthData.user.id, email);
      memberId = newAuthData.user.id;
    }
  }

  // ④ Server-side price re-verification (T41 安全紅線：絕不信任 cart 快照價)
  let verifiedItems: VerifiedItem[];
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
    await touchCartUpdatedAt(serviceRole, cartId);
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

  // ⑤⑥⑦ Insert order + order_items in one transaction (retry once on
  // order_no collision). T76：改用 RPC，order_item insert 失敗會讓整個
  // function 連 orders 一起 rollback，不再留孤兒訂單。
  async function callCreateOrderRpc(no: string) {
    return serviceRole.rpc("create_order_with_items", {
      p_member_id: memberId,
      p_order_no: no,
      p_cart_id: cartId,
      p_recipient_name: recipientName,
      p_recipient_phone: recipientPhone,
      p_zip_code: zipCode,
      p_shipping_address: shippingAddress,
      p_subtotal: subtotal,
      p_shipping_fee: shippingFee,
      p_total_amount: totalAmount,
      p_custom_consent: true,
      p_consent_at: new Date().toISOString(),
      p_items: verifiedItems.map((item) => ({
        product_id: item.productId,
        product_name_snapshot: item.productName,
        quantity: item.quantity,
        unit_price_snapshot: item.verifiedUnitPrice,
        config_snapshot: item.configSnapshot,
      })),
    });
  }

  let orderNo = generateOrderNo();
  const firstAttempt = await callCreateOrderRpc(orderNo);
  let order = firstAttempt.data;
  const orderError = firstAttempt.error;

  if (orderError || !order) {
    if (orderError?.code === "23505") {
      // order_no collision — retry with a new number
      orderNo = generateOrderNo();
      const retry = await callCreateOrderRpc(orderNo);
      if (retry.error || !retry.data) {
        return { ok: false, error: "建立訂單失敗，請稍後再試" };
      }
      order = retry.data;
    } else {
      return { ok: false, error: "建立訂單失敗，請稍後再試" };
    }
  }

  // ⑧ Cart 保留至付款成功才刪除（T75，見 ensureOrderPaid）——order 已存 cart_id。

  // ⑨ Redirect to payment page
  redirect(`/checkout/pay?order=${orderNo}`);
}
