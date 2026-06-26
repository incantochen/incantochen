"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

type ActionResult = { ok: true } | { ok: false; error: string }

async function verifyOwnership(cartItemId: string) {
  const cookieStore = await cookies()
  const guestToken = cookieStore.get("guest_token")?.value
  if (!guestToken) {
    return { ok: false as const, error: "找不到購物車" }
  }

  const serviceRole = createServiceRoleClient()
  const { data: cartItem } = await serviceRole
    .from("cart_item")
    .select("id, cart:cart_id ( guest_token )")
    .eq("id", cartItemId)
    .maybeSingle()

  if (!cartItem || cartItem.cart.guest_token !== guestToken) {
    return { ok: false as const, error: "找不到此購物車項目" }
  }

  return { ok: true as const, serviceRole }
}

export async function updateCartItemQuantity(
  cartItemId: string,
  quantity: number,
): Promise<ActionResult> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return { ok: false, error: "數量不正確" }
  }

  const owned = await verifyOwnership(cartItemId)
  if (!owned.ok) {
    return owned
  }

  const { error } = await owned.serviceRole
    .from("cart_item")
    .update({ quantity })
    .eq("id", cartItemId)

  if (error) {
    return { ok: false, error: "更新數量失敗，請再試一次" }
  }

  revalidatePath("/cart")
  return { ok: true }
}

export async function removeCartItem(cartItemId: string): Promise<ActionResult> {
  const owned = await verifyOwnership(cartItemId)
  if (!owned.ok) {
    return owned
  }

  const { error } = await owned.serviceRole.from("cart_item").delete().eq("id", cartItemId)

  if (error) {
    return { ok: false, error: "移除失敗，請再試一次" }
  }

  revalidatePath("/cart")
  return { ok: true }
}
