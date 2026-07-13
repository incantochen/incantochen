import type { Database } from "@/types/database.types"

export type CategoryCode = Database["public"]["Enums"]["product_category"]

export const CATEGORY_LABELS: Record<CategoryCode, string> = {
  ring: "戒指",
  earring: "耳環",
  bracelet: "手鍊",
  necklace: "項鍊",
}

export const ALL_CATEGORIES: CategoryCode[] = ["ring", "earring", "bracelet", "necklace"]
