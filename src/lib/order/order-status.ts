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

export const STATUS_PILL_STYLES: Record<OrderStatus, string> = {
  pending_payment: "bg-warning/10 text-warning",
  paid: "bg-success/10 text-success",
  in_production: "bg-info/10 text-info",
  shipped: "bg-primary/10 text-primary",
  completed: "bg-success/10 text-success",
  cancelled: "bg-stone text-ash",
  refunded: "bg-destructive/10 text-destructive",
};
