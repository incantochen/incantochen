"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getClientIp } from "@/lib/get-client-ip";
import { checkCartWriteRateLimit } from "@/lib/rate-limit";
import { touchCartUpdatedAt } from "@/lib/cart/touch-cart-updated-at";
import {
  resolveCartIdentity,
  type CartIdentity,
} from "@/lib/cart/resolve-cart-identity";

type ActionResult = { ok: true } | { ok: false; error: string };

async function verifyOwnership(cartItemId: string) {
  // T81：擁有權比對改依身分——登入者比 cart.member_id、訪客比 cart.guest_token。
  // resolver 在 Auth 端暫時性故障時會 throw（查詢失敗 ≠ 已登出），這裡轉成
  // 本檔的 {ok:false} 契約，不讓 server action 裸 throw 打壞前端錯誤顯示。
  let identity: CartIdentity;
  try {
    identity = await resolveCartIdentity();
  } catch {
    return { ok: false as const, error: "查詢購物車失敗，請再試一次" };
  }
  if (identity.kind === "none") {
    return { ok: false as const, error: "找不到購物車" };
  }

  const headersList = await headers();
  const ip = getClientIp(headersList);

  // 限流第二鍵用穩定身分值（登入→memberId、訪客→guest_token），避免登入前後
  // 同一人打到不同 bucket。
  const rateLimitKey =
    identity.kind === "member" ? identity.memberId : identity.guestToken;
  if (!(await checkCartWriteRateLimit(ip, rateLimitKey))) {
    return { ok: false as const, error: "操作過於頻繁，請稍後再試" };
  }

  const serviceRole = createServiceRoleClient();
  const { data: cartItem, error: cartItemError } = await serviceRole
    .from("cart_item")
    .select("id, cart_id, cart:cart_id ( member_id, guest_token )")
    .eq("id", cartItemId)
    .maybeSingle();

  if (cartItemError) {
    return { ok: false as const, error: "查詢購物車失敗，請再試一次" };
  }

  // 依身分核對擁有權：登入者只認自己 member_id 的車，訪客只認自己 token 的車。
  const owned =
    cartItem !== null &&
    (identity.kind === "member"
      ? cartItem.cart.member_id === identity.memberId
      : cartItem.cart.guest_token === identity.guestToken);

  if (!owned) {
    return { ok: false as const, error: "找不到此購物車項目" };
  }

  return { ok: true as const, serviceRole, cartId: cartItem.cart_id };
}

export async function updateCartItemQuantity(
  cartItemId: string,
  quantity: number,
): Promise<ActionResult> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return { ok: false, error: "數量不正確" };
  }

  const owned = await verifyOwnership(cartItemId);
  if (!owned.ok) {
    return owned;
  }

  const { error } = await owned.serviceRole
    .from("cart_item")
    .update({ quantity })
    .eq("id", cartItemId);

  if (error) {
    return { ok: false, error: "更新數量失敗，請再試一次" };
  }

  await touchCartUpdatedAt(owned.serviceRole, owned.cartId);

  revalidatePath("/cart");
  return { ok: true };
}

export async function removeCartItem(
  cartItemId: string,
): Promise<ActionResult> {
  const owned = await verifyOwnership(cartItemId);
  if (!owned.ok) {
    return owned;
  }

  const { error } = await owned.serviceRole
    .from("cart_item")
    .delete()
    .eq("id", cartItemId);

  if (error) {
    return { ok: false, error: "移除失敗，請再試一次" };
  }

  await touchCartUpdatedAt(owned.serviceRole, owned.cartId);

  revalidatePath("/cart");
  return { ok: true };
}
