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

  // T95（F-008）：查詢失敗 ≠ 查無資料——DB 暫時性故障若照樣回 null，客人
  // 會看到「購物袋是空的」的誤報。throw 交給 /cart 的 error boundary 顯示
  // 系統忙碌，不假裝購物車不存在。
  const { data: cart, error: cartError } = await serviceRole
    .from("cart")
    .select("id")
    .eq("guest_token", guestToken)
    .maybeSingle()

  if (cartError) {
    throw new Error(`讀取購物車失敗: ${cartError.message}`)
  }

  if (!cart) {
    return null
  }

  const { data: cartItems, error: cartItemsError } = await serviceRole
    .from("cart_item")
    .select("id, quantity, unit_price_snapshot, config_snapshot, product:product_id ( name, slug )")
    .eq("cart_id", cart.id)
    .order("created_at", { ascending: true })

  if (cartItemsError) {
    throw new Error(`讀取購物車品項失敗: ${cartItemsError.message}`)
  }

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
