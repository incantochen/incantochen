import "server-only";
import { sendOrderConfirmation } from "@/lib/email/order-confirmation";
import { sendNewOrderNotification } from "@/lib/email/new-order-notification";
import { sendOrderShippedNotification } from "@/lib/email/order-shipped-notification";
import { PAID_LINEAGE, type OrderStatus } from "@/lib/order/order-status";

// notification.type → 寄信函式與適寄訂單狀態的單一對照表（T88 sweep）。
// 每日 reconcile cron 補寄 failed 通知時，靠它把 type 還原成實際寄送動作，
// 並以 eligibleStatuses 避免對已取消／退款的訂單誤寄。新增通知類型時在此
// 登記一筆即可自動被 sweep 涵蓋。
export const NOTIFICATION_SENDERS: Record<
  string,
  {
    send: (orderId: string) => Promise<void>;
    eligibleStatuses: readonly OrderStatus[];
  }
> = {
  order_confirmation: {
    send: sendOrderConfirmation,
    eligibleStatuses: PAID_LINEAGE,
  },
  new_order_notification: {
    send: sendNewOrderNotification,
    eligibleStatuses: PAID_LINEAGE,
  },
  order_shipped: {
    send: sendOrderShippedNotification,
    eligibleStatuses: ["shipped", "completed"],
  },
};
