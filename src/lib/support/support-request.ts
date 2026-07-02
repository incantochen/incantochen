import type { OrderStatus } from "@/lib/order/order-status";

export type SupportRequestType = "return_defect" | "repair_maintenance";

export const REQUEST_TYPE_LABELS: Record<SupportRequestType, string> = {
  return_defect: "退貨/瑕疵",
  repair_maintenance: "維修/保養",
};

export type SupportRequestStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "rejected";

export const SUPPORT_STATUS_LABELS: Record<SupportRequestStatus, string> = {
  pending: "已收到申請",
  in_progress: "處理中",
  completed: "已完成",
  rejected: "已駁回",
};

export const SUPPORT_STATUS_PILL_STYLES: Record<SupportRequestStatus, string> =
  {
    pending: "bg-warning/10 text-warning",
    in_progress: "bg-info/10 text-info",
    completed: "bg-success/10 text-success",
    rejected: "bg-destructive/10 text-destructive",
  };

// 可申請售後的訂單狀態；pending_payment（交易未成立）、cancelled/refunded（終態）不可申請
export const SUPPORT_ELIGIBLE_STATUSES: OrderStatus[] = [
  "paid",
  "in_production",
  "shipped",
  "completed",
];

export function canRequestSupport(status: OrderStatus): boolean {
  return SUPPORT_ELIGIBLE_STATUSES.includes(status);
}

// ⚖️ TODO(T36): 草稿佔位，上線前以律師審定版取代
export const CUSTOM_NO_RETURN_NOTICE =
  "本店商品均為接單訂製之客製化商品，依法不適用七天鑑賞期。商品如有瑕疵或錯誤，請選擇「商品問題回報」並詳述狀況。若收到商品時有破損、瑕疵或寄錯商品，請於收到商品後 24 小時內聯絡我們。";
