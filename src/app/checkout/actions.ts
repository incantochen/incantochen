"use server";
import "server-only";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { findOrCreateMember } from "@/lib/auth/find-or-create-member";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import {
  checkoutFormSchema,
  type CheckoutFormValues,
} from "@/lib/checkout/schema";
import {
  createOrderFromCart,
  resolvePendingOrderForCart,
} from "@/lib/order/create-order-from-cart";
import { orderAccessCookieOptions } from "@/lib/order/order-access-token";
import { getClientIp } from "@/lib/get-client-ip";
import { checkCheckoutGuestRateLimit } from "@/lib/rate-limit";

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

  // §6：查詢失敗 ≠ 查無資料——DB 暫時性故障不可誤判成「購物車已空」。
  const { data: cart, error: cartError } = await serviceRole
    .from("cart")
    .select("id, updated_at")
    .eq("guest_token", guestToken)
    .maybeSingle();

  if (cartError) {
    return { ok: false, error: "讀取購物車失敗，請稍後再試" };
  }
  if (!cart) {
    return { ok: false, error: "購物車已空，請重新加入商品" };
  }
  const cartId = cart.id;

  const { data: cartItems, error: cartItemsError } = await serviceRole
    .from("cart_item")
    .select("id, product_id, quantity, unit_price_snapshot, config_snapshot")
    .eq("cart_id", cartId);

  if (cartItemsError) {
    return { ok: false, error: "讀取購物車失敗，請稍後再試" };
  }
  if (!cartItems || cartItems.length === 0) {
    return { ok: false, error: "購物車已空，請重新加入商品" };
  }

  // ②-b Pending 訂單 dedup（T75）——必須在會員解析**之前**跑：訪客第一次
  // 成功建單時 member row 已隨之建立，若先解析會員，重送未變更 cart 會撞上
  // 「email 已註冊請登入」而拿不到既有訂單的付款頁。cart 由 guest_token
  // cookie 綁定、本來就是本人的，故不帶 memberId 比對。
  const pending = await resolvePendingOrderForCart(
    serviceRole,
    cartId,
    cart.updated_at,
    { recipientName, recipientPhone, zipCode, shippingAddress },
  );
  if (pending.kind === "error") {
    return { ok: false, error: pending.error };
  }
  if (pending.kind === "reuse") {
    cookieStore.set(orderAccessCookieOptions(pending.orderNo));
    redirect(`/checkout/pay?order=${pending.orderNo}`);
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

  // ④⑤⑥⑦⑧ 驗價、金額計算、建單（R-S-Q／order_no 撞號重試）：
  // 共用核心邏輯，見 createOrderFromCart（客人與 admin 代客建單共用）。
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

  // ⑨ Redirect to payment page
  cookieStore.set(orderAccessCookieOptions(result.orderNo));
  redirect(`/checkout/pay?order=${result.orderNo}`);
}
