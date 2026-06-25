import { cookies } from "next/headers"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export type CartItemView = {
  id: string
  productName: string
  productSlug: string
  selectionsSummary: string
  quantity: number
  unitPriceSnapshot: number
  lineTotal: number
}

export async function getCart(): Promise<{ items: CartItemView[]; subtotal: number } | null> {
  const cookieStore = await cookies()
  const guestToken = cookieStore.get("guest_token")?.value
  if (!guestToken) {
    return null
  }

  const serviceRole = createServiceRoleClient()

  const { data: cart } = await serviceRole
    .from("cart")
    .select("id")
    .eq("guest_token", guestToken)
    .maybeSingle()

  if (!cart) {
    return null
  }

  const { data: cartItems } = await serviceRole
    .from("cart_item")
    .select("id, quantity, unit_price_snapshot, config_snapshot, product:product_id ( name, slug )")
    .eq("cart_id", cart.id)
    .order("created_at", { ascending: true })

  if (!cartItems || cartItems.length === 0) {
    return null
  }

  const items: CartItemView[] = cartItems.map((item) => {
    const snapshot = item.config_snapshot as {
      selections?: { label: string }[]
    }
    return {
      id: item.id,
      productName: item.product.name,
      productSlug: item.product.slug,
      selectionsSummary: (snapshot.selections ?? []).map((s) => s.label).join(" · "),
      quantity: item.quantity,
      unitPriceSnapshot: item.unit_price_snapshot,
      lineTotal: item.unit_price_snapshot * item.quantity,
    }
  })

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)

  return { items, subtotal }
}
