import "server-only"
import { z } from "zod"
import type { createServiceRoleClient } from "@/lib/supabase/service-role"
import type { Json } from "@/types/database.types"

const selectionSchema = z.object({
  option_type_code: z.string(),
  option_value_code: z.string(),
  label: z.string(),
  price_delta: z.number().finite(),
})

const configSnapshotSchema = z.object({
  product_id: z.string().uuid(),
  base_price: z.number().finite(),
  selections: z.array(selectionSchema),
  line_unit_price: z.number().finite(),
})

export type VerifiedItem = {
  cartItemId: string
  productId: string
  quantity: number
  verifiedUnitPrice: number
  configSnapshot: Json   // rebuilt from DB, not copied from cart snapshot
  priceChanged: boolean
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
    // Validate config_snapshot shape — cart snapshot is self-written but verifier
    // must not assume it hasn't been tampered with
    const parsed = configSnapshotSchema.safeParse(item.config_snapshot)
    if (!parsed.success) {
      throw new Error(`購物車項目設定損壞，請重新加入商品`)
    }
    const config = parsed.data

    // Re-fetch current base_price; reject if product is inactive/missing
    const { data: product } = await serviceRole
      .from("product")
      .select("base_price")
      .eq("id", config.product_id)
      .eq("status", "active")
      .maybeSingle()

    if (!product) {
      throw new Error(`商品已下架或不存在，無法建立訂單`)
    }

    // Guard against DB-side base_price corruption (NaN, Infinity, negative)
    const rawBasePrice: unknown = product.base_price
    if (typeof rawBasePrice !== "number" || !Number.isFinite(rawBasePrice) || rawBasePrice < 0) {
      throw new Error(`商品定價資料異常，無法建立訂單`)
    }

    // Re-fetch option whitelist (same join as addToCart) — add label so we can
    // rebuild a self-consistent configSnapshot with current DB data
    const { data: productOptions } = await serviceRole
      .from("product_option")
      .select(`
        option_type:option_type_id ( code ),
        product_option_value ( price_delta, option_value:option_value_id ( code, label ) )
      `)
      .eq("product_id", config.product_id)

    if (!productOptions) {
      throw new Error(`無法取得商品選項，請稍後再試`)
    }

    // Map: option_type_code → option_value_code → { priceDelta, label }
    const priceMap = new Map<string, Map<string, { priceDelta: number; label: string }>>()
    for (const po of productOptions) {
      const typeCode = po.option_type.code
      const valueMap = new Map<string, { priceDelta: number; label: string }>()
      for (const pov of po.product_option_value) {
        // Guard against DB-side price_delta corruption (null, NaN, Infinity, string)
        const rawPriceDelta: unknown = pov.price_delta
        if (typeof rawPriceDelta !== "number" || !Number.isFinite(rawPriceDelta)) {
          throw new Error(`選項定價資料異常，無法建立訂單`)
        }
        valueMap.set(pov.option_value.code, {
          priceDelta: rawPriceDelta,
          label: pov.option_value.label,
        })
      }
      priceMap.set(typeCode, valueMap)
    }

    // Recalculate price and rebuild selections using current DB data
    let verifiedUnitPrice = rawBasePrice
    const verifiedSelections: {
      option_type_code: string
      option_value_code: string
      label: string
      price_delta: number
    }[] = []

    for (const sel of config.selections) {
      const typeMap = priceMap.get(sel.option_type_code)
      if (!typeMap) {
        throw new Error(`選項類別「${sel.option_type_code}」不在此商品白名單，無法建立訂單`)
      }
      const entry = typeMap.get(sel.option_value_code)
      if (entry === undefined) {
        throw new Error(`選項值「${sel.option_value_code}」不在此商品白名單，無法建立訂單`)
      }
      verifiedUnitPrice += entry.priceDelta
      verifiedSelections.push({
        option_type_code: sel.option_type_code,
        option_value_code: sel.option_value_code,
        label: entry.label,
        price_delta: entry.priceDelta,
      })
    }

    // Round to cents to avoid floating point drift
    verifiedUnitPrice = Math.round(verifiedUnitPrice * 100) / 100

    if (verifiedUnitPrice < 0) {
      throw new Error(`商品最終定價不得為負數，無法建立訂單`)
    }

    // Rebuild configSnapshot entirely from DB — never carry forward stale snapshot values
    const verifiedConfigSnapshot: Json = {
      product_id: config.product_id,
      base_price: rawBasePrice,
      selections: verifiedSelections as unknown as Json[],
      line_unit_price: verifiedUnitPrice,
    }

    const roundedSnapshot = Math.round(item.unit_price_snapshot * 100) / 100

    results.push({
      cartItemId: item.id,
      productId: item.product_id,
      quantity: item.quantity,
      verifiedUnitPrice,
      configSnapshot: verifiedConfigSnapshot,
      priceChanged: verifiedUnitPrice !== roundedSnapshot,
    })
  }

  return results
}
