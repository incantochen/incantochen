export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "in_production"
  | "shipped"
  | "completed"
  | "cancelled"
  | "refunded";

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

// 後台專用（Tailwind gray 素色，與前台品牌 token 刻意分開，CLAUDE.md §後台）；
// 原本 admin/orders/page.tsx 與 admin/orders/[id]/page.tsx 各自複製一份，
// 抽到這裡單一出處。
export const ADMIN_STATUS_COLORS: Record<OrderStatus, string> = {
  pending_payment: "bg-amber-100 text-amber-800",
  paid: "bg-blue-100 text-blue-800",
  in_production: "bg-purple-100 text-purple-800",
  shipped: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-700",
  refunded: "bg-red-100 text-red-800",
};
