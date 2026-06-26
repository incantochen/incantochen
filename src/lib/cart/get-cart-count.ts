import "server-only"
import { cookies } from "next/headers"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export async function getCartCount(): Promise<number> {
  const cookieStore = await cookies()
  const guestToken = cookieStore.get("guest_token")?.value
  if (!guestToken) return 0

  const serviceRole = createServiceRoleClient()
  const { data: cart } = await serviceRole
    .from("cart")
    .select("id")
    .eq("guest_token", guestToken)
    .maybeSingle()

  if (!cart) return 0

  const { count } = await serviceRole
    .from("cart_item")
    .select("*", { count: "exact", head: true })
    .eq("cart_id", cart.id)

  return count ?? 0
}
