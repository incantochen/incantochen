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
