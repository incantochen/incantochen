import "server-only"
import * as Sentry from "@sentry/nextjs"
import { cookies } from "next/headers"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export async function getCartCount(): Promise<number> {
  const cookieStore = await cookies()
  const guestToken = cookieStore.get("guest_token")?.value
  if (!guestToken) return 0

  const serviceRole = createServiceRoleClient()
  const { data: cart, error: cartError } = await serviceRole
    .from("cart")
    .select("id")
    .eq("guest_token", guestToken)
    .maybeSingle()

  // T95（F-008）：徽章屬裝飾性——DB 故障時 throw 會讓全站 header 一起掛，
  // 故 fail-soft 回 0；但必須記 Sentry 保留可觀測性，不得完全靜默（§6）。
  if (cartError) {
    Sentry.captureException(cartError, {
      tags: { area: "cart-count", failMode: "fail-soft" },
    })
    return 0
  }

  if (!cart) return 0

  const { count, error: countError } = await serviceRole
    .from("cart_item")
    .select("*", { count: "exact", head: true })
    .eq("cart_id", cart.id)

  if (countError) {
    Sentry.captureException(countError, {
      tags: { area: "cart-count", failMode: "fail-soft" },
    })
    return 0
  }

  return count ?? 0
}
