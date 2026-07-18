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
import {
  invoiceTargetToMeta,
  type InvoiceTargetInput,
} from "@/lib/order/invoice-meta";
import {
  checkCompanyIdentifier,
  checkBarcode,
} from "@/lib/ecpay/invoice/validate";
import { orderAccessCookieOptions } from "@/lib/order/order-access-token";
import { getClientIp } from "@/lib/get-client-ip";
import {
  resolveCartIdentity,
  findCartByIdentity,
  type CartIdentity,
} from "@/lib/cart/resolve-cart-identity";
import { backfillCartMemberId } from "@/lib/cart/merge-guest-cart";
import {
  checkCheckoutGuestRateLimit,
  checkInvoiceValidateRateLimit,
} from "@/lib/rate-limit";
import * as Sentry from "@sentry/nextjs";

type CreateOrderResult = {
  ok: false;
  error: string;
  priceUpdated?: true;
  requiresLogin?: true;
  showCartLink?: true;
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

  // T42：三選一互斥已由 checkoutFormSchema 的 superRefine 保證格式正確，
  // 這裡只需照 invoiceTarget 組出對應的 InvoiceTargetInput。
  const invoiceTarget: InvoiceTargetInput =
    parsed.data.invoiceTarget === "company"
      ? { target: "company", customerIdentifier: parsed.data.taxId! }
      : parsed.data.invoiceTarget === "mobile_barcode"
        ? { target: "mobile_barcode", carrierNum: parsed.data.carrierBarcode! }
        : { target: "personal" };

  const serviceRole = createServiceRoleClient();
  const cookieStore = await cookies();

  // ② Read cart (service role — RLS blocks all direct reads)
  // T81：resolver 決定身分（登入→member、訪客→guest）；guestToken 仍留作
  // 下方訪客限流的第二鍵與 pending 去重比對。resolver 在 Auth 端暫時性故障時
  // throw（查詢失敗 ≠ 已登出），轉成本檔的 {ok:false} 契約。
  let identity: CartIdentity;
  try {
    identity = await resolveCartIdentity();
  } catch {
    return { ok: false, error: "讀取購物車失敗，請稍後再試" };
  }
  const guestToken =
    identity.kind === "guest" ? identity.guestToken : undefined;

  if (identity.kind === "none") {
    return { ok: false, error: "購物車已空，請重新加入商品" };
  }

  // §6：查詢失敗 ≠ 查無資料——DB 暫時性故障不可誤判成「購物車已空」。
  const { data: cart, error: cartError } = await findCartByIdentity(
    serviceRole,
    identity,
  );

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

  const headersList = await headers();
  const ip = getClientIp(headersList);

  // T42：統編／手機條碼打 ECPay 驗證 API 擋明確無效值（檢查碼錯的統編、
  // 查無歸戶的條碼）——這是 zod 格式檢查之外的真正防線，建單前擋下，
  // 不讓錯誤資料流到付款後才在開立時爆掉。驗證 API 自身故障時不阻擋
  // （validate.ts 內建 fail-open，官方原則：只有明確無效才擋）。
  // T129（F-024）：這段對 ECPay 發送真實外部請求，搬到 cart 非空確認之後
  // 才執行，避免沒有真實購物車的請求也能點燃外部呼叫；company／
  // mobile_barcode 才會真的打 API，故限流閘也只在這兩個分支前檢查。
  if (
    invoiceTarget.target === "company" ||
    invoiceTarget.target === "mobile_barcode"
  ) {
    if (!(await checkInvoiceValidateRateLimit(ip))) {
      return { ok: false, error: "請求太頻繁，請稍後再試" };
    }
  }
  if (invoiceTarget.target === "company") {
    const check = await checkCompanyIdentifier(
      invoiceTarget.customerIdentifier,
    );
    if (check.blocked) {
      return { ok: false, error: check.error ?? "統一編號驗證未通過" };
    }
  } else if (invoiceTarget.target === "mobile_barcode") {
    const check = await checkBarcode(invoiceTarget.carrierNum);
    if (check.blocked) {
      return { ok: false, error: check.error ?? "手機條碼驗證未通過" };
    }
  }

  // ②-b Pending 訂單 dedup（T75）——必須在**會員建立／既有會員比對**之前跑：
  // 訪客第一次成功建單時 member row 已隨之建立，若先解析會員，重送未變更 cart
  // 會撞上「email 已註冊請登入」而拿不到既有訂單的付款頁。（T81：resolver 在
  // 上方已呼叫過 getUser 判身分，但那只是讀取、無副作用，不影響此順序約束——
  // 約束針對的是下方 createUser／existingMember 查詢，不是 getUser。）訪客 cart
  // 由 guest_token 綁定、本來就是本人的，故不帶 memberId 比對。
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
    // T42：沿用既有 pending 訂單時仍要帶入**這次**選的發票去向——客人可能
    // 上次選個人、這次改成統編後重送（車與收件都沒變＝命中 reuse）。發票
    // 尚未開立（invoice_status='none' 守衛），此時更新安全；失敗不擋付款
    // （記 Sentry，開立時 fallback 舊值或個人發票）。
    const { error: metaError } = await serviceRole
      .from("orders")
      .update({ invoice_meta: invoiceTargetToMeta(invoiceTarget) })
      .eq("order_no", pending.orderNo)
      .eq("status", "pending_payment")
      .eq("invoice_status", "none");
    if (metaError) {
      console.error(
        "[createOrder] reuse 路徑 invoice_meta 更新失敗",
        metaError,
      );
      Sentry.captureMessage("createOrder: reuse 路徑 invoice_meta 更新失敗", {
        level: "warning",
        extra: { orderNo: pending.orderNo, error: metaError.message },
      });
    }
    cookieStore.set(orderAccessCookieOptions(pending.orderNo));
    redirect(`/checkout/pay?order=${pending.orderNo}`);
  }

  // ③ Member find-or-create ("結帳即會員")
  // T81 max review #4：member／guest 分流**只認上方 resolver 的 identity**，不再
  // 二次 getUser() 重判——兩次獨立讀 session 中間隔著 ECPay 驗證等真實 I/O，第二
  // 次暫時性失敗會把已登入會員誤導進訪客分支：cartId 是會員的車、memberId 卻是
  // 表單 email 新建的會員（RPC 不比對兩者），訂單掛錯人。getUser 在 member 分支
  // 只補抓 email（member row 建立用），失敗退回表單 email，不影響身分判定。
  let memberId: string;

  if (identity.kind === "member") {
    let sessionEmail: string | null = null;
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      sessionEmail = user?.email ?? null;
    } catch {
      // email 補抓失敗不擋建單——身分已由 identity 定案，退回表單 email。
    }
    // T71 ultra review #3：session email 跟訪客分支的正規化保持一致，
    // 避免 member.email 累積不同大小寫版本、之後訪客查詢比對不到。
    await findOrCreateMember(
      identity.memberId,
      sessionEmail ? normalizeEmail(sessionEmail) : email,
    );
    memberId = identity.memberId;
  } else {
    // T71 ultra review：這個分支等於一個帳號存在偵測 oracle（email 是否命中
    // 既有會員），先限流再查，避免被拿去大量掃描 email。命中限流時刻意不帶
    // requiresLogin，回應要跟「單純太頻繁」無法區分。
    // T129：ip／headersList 已在上方發票驗證前取過，這裡沿用同一份、不重複呼叫。
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

    // T81：結帳即會員——把當前 cart 掛到新會員名下（保留 guest_token，見
    // backfillCartMemberId 註解），補上「結帳路徑也不設 member_id」的缺口，
    // 新會員的車跨裝置可見。fail-soft：失敗不擋建單（車仍靠 guest_token 綁定）。
    await backfillCartMemberId(serviceRole, memberId, cartId);
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
    invoiceTarget,
  );

  if (!result.ok) {
    return result;
  }

  // ⑨ Redirect to payment page
  cookieStore.set(orderAccessCookieOptions(result.orderNo));
  redirect(`/checkout/pay?order=${result.orderNo}`);
}
