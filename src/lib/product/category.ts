import type { Database } from "@/types/database.types"

export type CategoryCode = Database["public"]["Enums"]["product_category"]

export const CATEGORY_LABELS: Record<CategoryCode, string> = {
  ring: "戒指",
  earring: "耳環",
  bracelet: "手鍊",
  necklace: "項鍊",
}

// 由 CATEGORY_LABELS 的 key 衍生（而非另外手key陣列）：CATEGORY_LABELS 型別是
// Record<CategoryCode, string>，少列舉一個 enum 值會直接編譯錯誤；衍生陣列可
// 確保未來 DB 加新品類時，這裡不會因為「手動陣列忘記同步」而悄悄漏掉。
export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as CategoryCode[]
