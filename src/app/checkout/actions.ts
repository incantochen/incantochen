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
import type { Json } from "@/types/database.types";
import { z } from "zod";

type CreateOrderResult = { ok: false; error: string; priceUpdated?: true };

// T76：create_order_with_items 的 p_items 參數在 RPC 那端是未型別化的 jsonb，
// 不像先前直接 .insert() 到 order_item 時能靠生成型別做端到端檢查。這裡在送
// 進 RPC 之前先驗一次形狀，把「欄位改名/漏欄位」這類契約走鐘及早攔下，不必
// 等到 DB 端因型別轉換失敗或（更糟）安靜寫入錯的值才發現。
const orderItemPayloadSchema = z
  .array(
    z.object({
      product_id: z.string().uuid(),
      product_name_snapshot: z.string().min(1),
      quantity: z.number().int().positive(),
      unit_price_snapshot: z.number().nonnegative(),
      config_snapshot: z.custom<Json>(),
    }),
  )
  .min(1);

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

  // T75 讓 cart 在下單後、付款前這段期間繼續存在，代表客人可能回到 /cart
  // 對同一張還沒結案的購物車重複按「結帳」。若已有一筆指向這張 cart 的
  // pending_payment 訂單，直接導去它的付款頁，不要另外開一張新訂單造成
  // 重複下單／重複收款的風險。
  const { data: existingPendingOrder } = await serviceRole
    .from("orders")
    .select("order_no")
    .eq("cart_id", cartId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingPendingOrder) {
    redirect(`/checkout/pay?order=${existingPendingOrder.order_no}`);
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
  const itemsPayload = orderItemPayloadSchema.parse(
    verifiedItems.map((item) => ({
      product_id: item.productId,
      product_name_snapshot: item.productName,
      quantity: item.quantity,
      unit_price_snapshot: item.verifiedUnitPrice,
      config_snapshot: item.configSnapshot,
    })),
  );
  const consentAt = new Date().toISOString();

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
      p_consent_at: consentAt,
      p_items: itemsPayload,
    });
  }

  // 兩次嘗試（首發＋order_no 撞號重試）共用同一套錯誤分類，避免像先前那樣
  // 重試那次的分支把「購物車已過期」（23503）跟其他失敗混在一起，讓客人看到
  // 不對應實情的通用錯誤訊息。
  let orderNo = generateOrderNo();
  let { data: order, error: orderError } = await callCreateOrderRpc(orderNo);

  if (!order && orderError?.code === "23505") {
    orderNo = generateOrderNo();
    ({ data: order, error: orderError } = await callCreateOrderRpc(orderNo));
  }

  if (!order) {
    if (orderError?.code === "23503") {
      // orders.cart_id FK 違反：cart 在讀取後、RPC 寫入前被刪除（例如剛好被
      // T78 訪客車過期清理排程掃到）。重試沒有意義（cart 已不存在），請客人
      // 重新整理購物車。
      return { ok: false, error: "購物車已過期，請重新整理購物車後再試一次" };
    }
    return { ok: false, error: "建立訂單失敗，請稍後再試" };
  }

  // ⑧ Cart 保留至付款成功才刪除（T75，見 ensureOrderPaid）——order 已存 cart_id。

  // ⑨ Redirect to payment page
  redirect(`/checkout/pay?order=${orderNo}`);
}
