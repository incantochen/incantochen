"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { findOrCreateMember } from "@/lib/auth/find-or-create-member";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import {
  checkoutFormSchema,
  type CheckoutFormValues,
} from "@/lib/checkout/schema";
import { verifyCartPrices, type VerifiedItem } from "@/lib/quote/verify-prices";
import { touchCartUpdatedAt } from "@/lib/cart/touch-cart-updated-at";
import { getClientIp } from "@/lib/get-client-ip";
import { checkCheckoutGuestRateLimit } from "@/lib/rate-limit";
import {
  transitionOrder,
  OrderTransitionRaceError,
} from "@/lib/order/state-machine";
import type { Json } from "@/types/database.types";
import { z } from "zod";

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
  const { recipientName, recipientPhone, zipCode, shippingAddress } =
    parsed.data;
  // T71：正規化，避免大小寫變體繞過既有會員比對。
  const email = normalizeEmail(parsed.data.email);

  const serviceRole = createServiceRoleClient();
  const cookieStore = await cookies();
  const guestToken = cookieStore.get("guest_token")?.value;

  // ② Read cart (service role — RLS blocks all direct reads)
  if (!guestToken) {
    return { ok: false, error: "購物車已空，請重新加入商品" };
  }

  const { data: cart } = await serviceRole
    .from("cart")
    .select("id, updated_at")
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
  // 對同一張還沒結案的購物車重複按「結帳」。
  // - cart 沒被再動過：這是同一份內容的重複送出，直接導去既有訂單的付款頁。
  // - cart 有被動過（加了商品／改了數量）：既有訂單已不代表客人現在要買的
  //   東西，不能把人導去付舊金額——把舊單取消（pending_payment→cancelled
  //   合法轉換），往下走正常建單流程用最新內容開新單。
  // 查詢失敗必須擋下而非放行（§6：查詢失敗 ≠ 查無資料）——dedup 防護在 DB
  // 不穩時 fail-open 等於雙重下單風險最高的時刻防護自動消失。
  const { data: existingPendingOrder, error: dedupError } = await serviceRole
    .from("orders")
    .select("id, order_no, created_at")
    .eq("cart_id", cartId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dedupError) {
    return { ok: false, error: "建立訂單失敗，請稍後再試" };
  }

  if (existingPendingOrder) {
    if (cart.updated_at <= existingPendingOrder.created_at) {
      redirect(`/checkout/pay?order=${existingPendingOrder.order_no}`);
    }
    try {
      await transitionOrder(existingPendingOrder.id, "cancelled", {
        note: "購物車內容已變更，舊待付款訂單自動取消（重新結帳）",
      });
    } catch (e) {
      if (e instanceof OrderTransitionRaceError) {
        // 舊單剛好被其他流程動過（多半是 webhook 轉 paid）——導去它的付款頁，
        // 該頁會依最新狀態決定去向（已付款則進成功頁）。
        redirect(`/checkout/pay?order=${existingPendingOrder.order_no}`);
      }
      // Server Action 拋錯在 production 會被 Next.js 遮罩成通用訊息，
      // 統一走結構化回傳讓表單顯示錯誤。
      return { ok: false, error: "建立訂單失敗，請稍後再試" };
    }
  }

  // ③ Member find-or-create ("結帳即會員")
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let memberId: string;

  if (user) {
    // Already logged in — ensure member row exists
    // T71 ultra review #3：user.email 來自 session，跟訪客分支的正規化保持一致，
    // 避免 member.email 累積不同大小寫版本、之後訪客查詢比對不到。
    await findOrCreateMember(
      user.id,
      user.email ? normalizeEmail(user.email) : email,
    );
    memberId = user.id;
  } else {
    // T71 ultra review：這個分支等於一個帳號存在偵測 oracle（email 是否命中
    // 既有會員），先限流再查，避免被拿去大量掃描 email。命中限流時刻意不帶
    // requiresLogin，回應要跟「單純太頻繁」無法區分。
    const headersList = await headers();
    const ip = getClientIp(headersList);
    if (!(await checkCheckoutGuestRateLimit(ip, guestToken))) {
      return { ok: false, error: "請求太頻繁，請稍後再試" };
    }

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
      // T71 ultra review #4：優先用結構化的錯誤碼判斷（穩定，不受措辭/語系影響），
      // 字串比對留作沒有 code 時的備援，不整個換掉以免漏接舊行為涵蓋到的情況。
      if (
        createError?.code === "email_exists" ||
        createError?.code === "user_already_exists" ||
        createError?.message?.toLowerCase().includes("already")
      ) {
        return REQUIRES_LOGIN_RESULT;
      }
      return { ok: false, error: "建立會員失敗，請稍後再試" };
    }
    await findOrCreateMember(newAuthData.user.id, email);
    memberId = newAuthData.user.id;
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
  // 23505 有兩個可能來源，靠 constraint 名稱區分：
  // - orders_order_no_key：order_no 撞號 → 換號重試一次
  // - uq_orders_one_pending_per_cart（0011）：併發雙送出搶輸 —— 另一個請求
  //   剛建好同一張 cart 的 pending 訂單，重查後導去它的付款頁（check-then-act
  //   dedup 的 DB 兜底，防雙重下單）
  const isPendingCartCollision = (err: { message?: string } | null) =>
    err?.message?.includes("uq_orders_one_pending_per_cart") ?? false;

  let orderNo = generateOrderNo();
  let { data: order, error: orderError } = await callCreateOrderRpc(orderNo);

  if (
    !order &&
    orderError?.code === "23505" &&
    !isPendingCartCollision(orderError)
  ) {
    orderNo = generateOrderNo();
    ({ data: order, error: orderError } = await callCreateOrderRpc(orderNo));
  }

  if (!order) {
    if (orderError?.code === "23505" && isPendingCartCollision(orderError)) {
      const { data: racedOrder, error: racedOrderError } = await serviceRole
        .from("orders")
        .select("order_no")
        .eq("cart_id", cartId)
        .eq("status", "pending_payment")
        .maybeSingle();
      if (racedOrderError) {
        return { ok: false, error: "建立訂單失敗，請稍後再試" };
      }
      if (racedOrder) {
        redirect(`/checkout/pay?order=${racedOrder.order_no}`);
      }
      return { ok: false, error: "建立訂單失敗，請稍後再試" };
    }
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
