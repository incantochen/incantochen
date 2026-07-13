import type { Database } from "@/types/database.types";

export type CategoryCode = Database["public"]["Enums"]["product_category"];

// 品類中文名的單一出處：前台 PDP 與後台商品列表共用
export const CATEGORY_LABELS: Record<CategoryCode, string> = {
  ring: "戒指",
  earring: "耳環",
  bracelet: "手鍊",
  necklace: "項鍊",
};

// 由 CATEGORY_LABELS 的 key 衍生，理由同 product-status.ts 的 ALL_PRODUCT_STATUSES。
export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as CategoryCode[];
