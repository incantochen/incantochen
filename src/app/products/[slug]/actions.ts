"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PG_UNIQUE_VIOLATION } from "@/lib/supabase/postgres-error-codes";
import { getClientIp } from "@/lib/get-client-ip";
import { checkCartWriteRateLimit } from "@/lib/rate-limit";
import { touchCartUpdatedAt } from "@/lib/cart/touch-cart-updated-at";
import {
  GUEST_TOKEN_COOKIE,
  guestTokenCookieOptions,
} from "@/lib/cart/guest-token";
import { getOrCreateMemberCart } from "@/lib/cart/get-or-create-member-cart";
import {
  resolveCartIdentity,
  type CartIdentity,
} from "@/lib/cart/resolve-cart-identity";

type AddToCartInput = {
  productId: string;
  productOptionValueIds: string[];
  quantity: number;
};

type AddToCartResult = { ok: true } | { ok: false; error: string };

export async function addToCart(
  input: AddToCartInput,
): Promise<AddToCartResult> {
  const { productId, productOptionValueIds, quantity } = input;

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return { ok: false, error: "數量不正確" };
  }

  const cookieStore = await cookies();
  let guestToken = cookieStore.get(GUEST_TOKEN_COOKIE)?.value;

  const headersList = await headers();
  const ip = getClientIp(headersList);

  const supabase = await createClient();

  // T81 max review #8：身分判定統一走 resolveCartIdentity（單一出處，identity
  // invariant 見該檔），不再自行 getUser 分流——「登入態絕不 fallback guest
  // token」這條安全不變式只維護一份。resolver 在 Auth 端暫時性故障時 throw
  // （查詢失敗 ≠ 已登出），轉成本檔的 {ok:false} 契約。
  let identity: CartIdentity;
  try {
    identity = await resolveCartIdentity();
  } catch {
    return { ok: false, error: "系統忙碌，請稍後再試" };
  }

  // 限流第二鍵用穩定身分值（登入→memberId、訪客→guest_token），避免登入前後
  // 同一人打到不同 bucket。
  const rateLimitKey =
    identity.kind === "member" ? identity.memberId : guestToken;
  if (!(await checkCartWriteRateLimit(ip, rateLimitKey))) {
    return { ok: false, error: "操作過於頻繁，請稍後再試" };
  }

  const { data: product, error: productError } = await supabase
    .from("product")
    .select("id, base_price, status")
    .eq("id", productId)
    .eq("status", "active")
    .single();

  // PGRST116 = single() 查無列，是正常的「商品不存在」；其餘 error 代表查詢本身
  // 失敗（DB 暫時性故障等），不得跟「查無資料」混為一談
  if (productError && productError.code !== "PGRST116") {
    return { ok: false, error: "系統忙碌，請稍後再試" };
  }
  if (!product) {
    return { ok: false, error: "商品不存在或已下架" };
  }

  // !inner 理由同 PDP 查詢：RLS 濾掉的隱藏選項要整列消失，不能變 null
  const { data: productOptions, error: productOptionsError } = await supabase
    .from("product_option")
    .select(
      `
      id, required,
      option_type:option_type_id!inner ( code, name ),
      product_option_value ( id, price_delta, option_value:option_value_id!inner ( code, label ) )
    `,
    )
    .eq("product_id", productId);

  if (productOptionsError) {
    return { ok: false, error: "系統忙碌，請稍後再試" };
  }
  if (!productOptions) {
    return { ok: false, error: "商品選項設定有誤" };
  }

  // T12：!inner 會讓「選項類型全部隱藏」跟「商品從未設定選項」在上面的查詢
  // 結果長得一樣（都是空陣列），但前者是正常的後台操作（管理員隱藏一個非
  // 必選選項），不該擋購買。只有在真的「從未設定任何選項」時才視為資料
  // 設定錯誤——用不受 !inner 過濾的 head-count 區分，只在空陣列時才多查
  // 一次（正常商品的熱路徑不受影響）。必選完整性仍由下面逐項檢查與
  // verify-prices.ts 的伺服器端白名單兜底，不受此處放行影響。
  if (productOptions.length === 0) {
    const { count, error: countError } = await supabase
      .from("product_option")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId);
    // 查詢失敗 ≠ 查無資料：countError 是 DB 暫時性故障，回「系統忙碌」而非
    // 「設定有誤」（與上方 product／product_option 兩處分流一致，CLAUDE.md §6）
    if (countError) {
      return { ok: false, error: "系統忙碌，請稍後再試" };
    }
    if (count && count > 0) {
      // 有 product_option 列，只是全被隱藏——視為「目前無可選配項目」，
      // 以下迴圈自然跳過（沒有東西可迭代），繼續走基本價購買
    } else {
      return { ok: false, error: "商品選項設定有誤" };
    }
  }

  const selections: {
    option_type_code: string;
    option_value_code: string;
    label: string;
    price_delta: number;
  }[] = [];

  for (const option of productOptions) {
    const selectedId = productOptionValueIds.find((id) =>
      option.product_option_value.some((value) => value.id === id),
    );
    if (option.required && !selectedId) {
      return { ok: false, error: `請選擇「${option.option_type.name}」` };
    }
    const selectedValue = option.product_option_value.find(
      (value) => value.id === selectedId,
    );
    if (selectedValue) {
      selections.push({
        option_type_code: option.option_type.code,
        option_value_code: selectedValue.option_value.code,
        label: selectedValue.option_value.label,
        price_delta: selectedValue.price_delta,
      });
    }
  }

  const lineUnitPrice =
    product.base_price + selections.reduce((sum, s) => sum + s.price_delta, 0);

  const configSnapshot = {
    product_id: product.id,
    base_price: product.base_price,
    selections,
    line_unit_price: lineUnitPrice,
  };

  const serviceRole = createServiceRoleClient();

  let cartId: string;
  // 訪客分支解析出的 guest_token，供結尾簽/續 cookie；member 分支維持 null。
  let guestCookieToSet: string | null = null;

  if (identity.kind === "member") {
    // T81 member 分支：取得（或建立）會員的車。getOrCreateMemberCart 內含
    // claim fallback（登入併車若失敗，這裡把 guest 車補收進會員名下）與
    // uq_cart_member 併發重查。member 分支不簽/不續 guest cookie。
    // email 只在 member row 缺席（孤兒 auth user）時用到——best-effort 補抓，
    // 失敗以空字串退場，不影響身分判定（身分已由 identity 定案）。
    let memberEmail = "";
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      memberEmail = user?.email ?? "";
    } catch {
      // best-effort：email 抓不到不擋加車。
    }
    const memberCart = await getOrCreateMemberCart(
      serviceRole,
      identity.memberId,
      memberEmail,
      guestToken,
    );
    if (!memberCart.ok) {
      return { ok: false, error: memberCart.error };
    }
    cartId = memberCart.cartId;
  } else {
    // 訪客分支（維持現行）：guest_token 綁 cart。
    if (!guestToken) {
      guestToken = crypto.randomUUID();
    }
    guestCookieToSet = guestToken;

    // read-first：回頭客（已有 guest_token 命中既有 cart）是常態，先 SELECT
    // 避免每次都付一次註定失敗的 INSERT＋unique_violation log（coding-system §3.2）
    const { data: existingCart, error: existingCartError } = await serviceRole
      .from("cart")
      .select("id")
      .eq("guest_token", guestToken)
      .maybeSingle();

    if (existingCartError) {
      return { ok: false, error: "系統忙碌，請稍後再試" };
    }

    if (existingCart) {
      cartId = existingCart.id;
    } else {
      const { data: newCart, error: cartError } = await serviceRole
        .from("cart")
        .insert({ guest_token: guestToken })
        .select("id")
        .single();

      if (newCart) {
        cartId = newCart.id;
      } else if (cartError?.code === PG_UNIQUE_VIOLATION) {
        // unique_violation（uq_cart_guest_token）：併發請求已插入同 guest_token
        // 的 cart，重查取回該筆，不再各自 insert 出重複 cart row
        const { data: raceCart, error: raceSelectError } = await serviceRole
          .from("cart")
          .select("id")
          .eq("guest_token", guestToken)
          .maybeSingle();
        if (raceSelectError || !raceCart) {
          return { ok: false, error: "建立購物車失敗" };
        }
        cartId = raceCart.id;
      } else {
        return { ok: false, error: "建立購物車失敗" };
      }
    }
  }

  const { error: insertError } = await serviceRole.from("cart_item").insert({
    cart_id: cartId,
    product_id: product.id,
    quantity,
    unit_price_snapshot: lineUnitPrice,
    config_snapshot: configSnapshot,
  });

  if (insertError) {
    return { ok: false, error: "加入購物車失敗，請再試一次" };
  }

  await touchCartUpdatedAt(serviceRole, cartId);

  // guest 分支才簽/續 guest cookie（決策 #14：效期僅由 addToCart 續命）；
  // member 分支 guestCookieToSet 維持 null、不碰 guest cookie。
  if (guestCookieToSet !== null) {
    cookieStore.set(
      GUEST_TOKEN_COOKIE,
      guestCookieToSet,
      guestTokenCookieOptions(),
    );
  }

  return { ok: true };
}
