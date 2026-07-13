import type { Database } from "@/types/database.types";

export type ProductStatus = Database["public"]["Enums"]["product_status"];

// label 與 admin badge 色綁同一筆（比照 order-status.ts 的集中放法），
// 新增狀態時不會只改到其中一張表
export const PRODUCT_STATUS_META: Record<
  ProductStatus,
  { label: string; color: string }
> = {
  draft: { label: "草稿", color: "bg-amber-100 text-amber-800" },
  active: { label: "上架中", color: "bg-green-100 text-green-800" },
  archived: { label: "已封存", color: "bg-gray-100 text-gray-700" },
};
