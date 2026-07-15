export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "in_production"
  | "shipped"
  | "completed"
  | "cancelled"
  | "refunded";

// 「付款已成立」的狀態集合（paid 與其一切後續）。付款成立契約類的通知（訂單
// 確認信等）在這些狀態下都應補寄——訂單推進到製作／出貨不代表確認信不用寄
//（T88 review：原本只認 paid，狀態一推進就靜默切斷失敗信件的重試）。
// cancelled／refunded 不在此列：對已取消／退款的訂單補寄確認信是誤導。
export const PAID_LINEAGE: OrderStatus[] = [
  "paid",
  "in_production",
  "shipped",
  "completed",
];

export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  paid: ["in_production", "refunded"],
  in_production: ["shipped", "refunded"],
  shipped: ["completed", "refunded"],
  completed: [],
  cancelled: [],
  refunded: [],
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "待付款",
  paid: "已付款",
  in_production: "製作中",
  shipped: "已出貨",
  completed: "已完成",
  cancelled: "已取消",
  refunded: "已退款",
};

// 前台／會員中心用（品牌 token）
export const STATUS_PILL_STYLES: Record<OrderStatus, string> = {
  pending_payment: "bg-warning/10 text-warning",
  paid: "bg-success/10 text-success",
  in_production: "bg-info/10 text-info",
  shipped: "bg-primary/10 text-primary",
  completed: "bg-success/10 text-success",
  cancelled: "bg-stone text-ash",
  refunded: "bg-destructive/10 text-destructive",
};

// T42：電子發票狀態的 admin pill meta（label+color 綁同筆，比照
// PRODUCT_STATUS_META 慣例集中於 lib，不散落元件內）。type 取自 DB enum，
// invoice_status 新增值時這裡編譯期就會報缺。
import type { Database } from "@/types/database.types";

export type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];

export const INVOICE_STATUS_META: Record<
  InvoiceStatus,
  { label: string; color: string }
> = {
  none: { label: "尚未開立", color: "bg-gray-100 text-gray-700" },
  issued: { label: "已開立", color: "bg-green-100 text-green-800" },
  allowance: { label: "已折讓", color: "bg-amber-100 text-amber-800" },
  voided: { label: "已作廢", color: "bg-red-100 text-red-800" },
};

// admin 端用 Tailwind gray 系素色（與前台品牌 token 刻意分開，CLAUDE.md §0.2）；
// 原本 admin/orders 列表與詳情頁各複製一份，T11 code review 收斂於此
export const ADMIN_STATUS_COLORS: Record<OrderStatus, string> = {
  pending_payment: "bg-amber-100 text-amber-800",
  paid: "bg-blue-100 text-blue-800",
  in_production: "bg-purple-100 text-purple-800",
  shipped: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-700",
  refunded: "bg-red-100 text-red-800",
};
