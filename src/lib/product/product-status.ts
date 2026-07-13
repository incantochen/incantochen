import type { Database } from "@/types/database.types"

export type ProductStatus = Database["public"]["Enums"]["product_status"]

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "草稿",
  active: "上架中",
  archived: "已封存",
}

// 由 PRODUCT_STATUS_LABELS 的 key 衍生，理由同 category.ts 的 ALL_CATEGORIES。
export const ALL_PRODUCT_STATUSES = Object.keys(PRODUCT_STATUS_LABELS) as ProductStatus[]

// 後台採 Tailwind gray 素色（與前台品牌 token 刻意分開，CLAUDE.md §後台）
export const PRODUCT_STATUS_PILL_STYLES: Record<ProductStatus, string> = {
  draft: "bg-amber-100 text-amber-800",
  active: "bg-green-100 text-green-800",
  archived: "bg-gray-100 text-gray-700",
}
