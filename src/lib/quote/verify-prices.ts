import "server-only"
import { z } from "zod"
import type { createServiceRoleClient } from "@/lib/supabase/service-role"
import type { Json } from "@/types/database.types"

// Mirrors the shape written by addToCart
const selectionSchema = z.object({
  option_type_code: z.string(),
  option_value_code: z.string(),
  label: z.string(),
  price_delta: z.number(),
})

const configSnapshotSchema = z.object({
  product_id: z.string().uuid(),
  base_price: z.number(),
  selections: z.array(selectionSchema),
  line_unit_price: z.number(),
})

export type VerifiedItem = {
  cartItemId: string
  productId: string
  quantity: number
  configSnapshot: Json
  verifiedUnitPrice: number
  changed: boolean
}

type CartItemInput = {
  id: string
  product_id: string
  quantity: number
  unit_price_snapshot: number
  config_snapshot: Json
}

type ServiceRole = ReturnType<typeof createServiceRoleClient>

export async function verifyCartPrices(
  serviceRole: ServiceRole,
  cartItems: CartItemInput[],
): Promise<VerifiedItem[]> {
  const results: VerifiedItem[] = []

  for (const item of cartItems) {
    // Validate config_snapshot shape with Zod
    const parsed = configSnapshotSchema.safeParse(item.config_snapshot)
    if (!parsed.success) {
      throw new Error(`購物車項目設定損壞（item ${item.id}）`)
    }
    const config = parsed.data

    // Re-fetch product base_price from DB (must still be active)
    const { data: product } = await serviceRole
      .from("product")
      .select("base_price")
      .eq("id", config.product_id)
      .eq("status", "active")
      .maybeSingle()

    if (!product) {
      throw new Error(`商品已下架或不存在，無法建立訂單`)
    }

    // Re-fetch option prices via the whitelist
    // product_option → option_type (code) + product_option_value → option_value (code) + price_delta
    const { data: productOptions } = await serviceRole
      .from("product_option")
      .select(`
        option_type:option_type_id ( code ),
        product_option_value ( price_delta, option_value:option_value_id ( code ) )
      `)
      .eq("product_id", config.product_id)

    if (!productOptions) {
      throw new Error(`無法取得商品選項，請稍後再試`)
    }

    // Build Map: option_type_code → option_value_code → price_delta
    const priceMap = new Map<string, Map<string, number>>()
    for (const po of productOptions) {
      const typeCode = po.option_type.code
      const valueMap = new Map<string, number>()
      for (const pov of po.product_option_value) {
        valueMap.set(pov.option_value.code, pov.price_delta)
      }
      priceMap.set(typeCode, valueMap)
    }

    // Recalculate verified unit price from current whitelist
    let verifiedUnitPrice = product.base_price
    for (const sel of config.selections) {
      const typeMap = priceMap.get(sel.option_type_code)
      if (!typeMap) {
        throw new Error(`選項類別「${sel.option_type_code}」不在此商品白名單，無法建立訂單`)
      }
      const priceDelta = typeMap.get(sel.option_value_code)
      if (priceDelta === undefined) {
        throw new Error(`選項值「${sel.option_value_code}」不在此商品白名單，無法建立訂單`)
      }
      verifiedUnitPrice += priceDelta
    }

    results.push({
      cartItemId: item.id,
      productId: item.product_id,
      quantity: item.quantity,
      configSnapshot: item.config_snapshot as Json,
      verifiedUnitPrice,
      changed: verifiedUnitPrice !== item.unit_price_snapshot,
    })
  }

  return results
}
