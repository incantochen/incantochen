"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getClientIp } from "@/lib/get-client-ip";
import { checkCartWriteRateLimit } from "@/lib/rate-limit";
import { touchCartUpdatedAt } from "@/lib/cart/touch-cart-updated-at";

const GUEST_TOKEN_COOKIE = "guest_token";
const GUEST_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, rolling

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

  if (!(await checkCartWriteRateLimit(ip, guestToken))) {
    return { ok: false, error: "操作過於頻繁，請稍後再試" };
  }

  const supabase = await createClient();

  const { data: product } = await supabase
    .from("product")
    .select("id, base_price, status")
    .eq("id", productId)
    .eq("status", "active")
    .single();

  if (!product) {
    return { ok: false, error: "商品不存在或已下架" };
  }

  // !inner 理由同 PDP 查詢：RLS 濾掉的隱藏選項要整列消失，不能變 null
  const { data: productOptions } = await supabase
    .from("product_option")
    .select(
      `
      id, required,
      option_type:option_type_id!inner ( code, name ),
      product_option_value ( id, price_delta, option_value:option_value_id!inner ( code, label ) )
    `,
    )
    .eq("product_id", productId);

  if (!productOptions || productOptions.length === 0) {
    return { ok: false, error: "商品選項設定有誤" };
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

  if (!guestToken) {
    guestToken = crypto.randomUUID();
  }

  const { data: newCart, error: cartError } = await serviceRole
    .from("cart")
    .insert({ guest_token: guestToken })
    .select("id")
    .single();

  let cartId: string;
  if (newCart) {
    cartId = newCart.id;
  } else if (cartError?.code === "23505") {
    // 23505 = unique_violation（uq_cart_guest_token）：併發請求已插入同 guest_token
    // 的 cart，重查取回該筆，不再各自 insert 出重複 cart row
    const { data: existingCart, error: selectError } = await serviceRole
      .from("cart")
      .select("id")
      .eq("guest_token", guestToken)
      .maybeSingle();
    if (selectError || !existingCart) {
      return { ok: false, error: "建立購物車失敗" };
    }
    cartId = existingCart.id;
  } else {
    return { ok: false, error: "建立購物車失敗" };
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

  cookieStore.set(GUEST_TOKEN_COOKIE, guestToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_TOKEN_MAX_AGE,
  });

  return { ok: true };
}
