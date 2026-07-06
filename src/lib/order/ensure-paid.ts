import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendOrderConfirmation } from "@/lib/email/order-confirmation";
import { sendNewOrderNotification } from "@/lib/email/new-order-notification";
import { sendOnce } from "@/lib/notification/send-once";

async function notifyOrderPaid(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
) {
  // sendOnce 保證不往外拋例外，兩通知彼此獨立，可安全平行處理。
  await Promise.all([
    sendOnce(serviceRole, {
      orderId,
      type: "order_confirmation",
      send: () => sendOrderConfirmation(orderId),
    }),
    sendOnce(serviceRole, {
      orderId,
      type: "new_order_notification",
      send: () => sendNewOrderNotification(orderId),
    }),
  ]);
}

// source 標示這次推進是被誰觸發（"webhook" 或 T89 的 "reconcile"），寫進
// order_status_log.note 供稽核——區分「webhook 正常推進」與「靠對帳兜底才推進」，
// 後者代表 webhook 當初失靈過，是 T90 runbook 判斷 webhook 可靠度的依據。
export async function ensureOrderPaid(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
  source: string,
) {
  // 條件式 UPDATE：只有真正搶到這次推進的請求才會拿到 promoted，
  // 避免兩個近乎同時抵達的重送請求都各自寫入 order_status_log（該表無 unique 約束）。
  // 訂單若已經是 paid（例如上次執行已推進成功、但通知半路失敗），這裡安全地
  // 不做任何事——推進與寄通知是兩件互不依賴、各自冪等的事，見 ensureNotificationSent。
  const { data: promoted, error } = await serviceRole
    .from("orders")
    .update({ status: "paid" })
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .select("id")
    .maybeSingle();

  // Supabase 對 statement timeout／連線池耗盡等暫時性錯誤不會 throw，只回傳
  // { error }；若不檢查，會跟「沒符合更新條件」混淆而靜默跳過，害呼叫端回
  // 成功讓上游不再重試，訂單就永遠卡在 pending_payment（明明已經付款）。
  if (error) throw new Error(`ensureOrderPaid failed: ${error.message}`);
  if (!promoted) return;

  const { error: logError } = await serviceRole
    .from("order_status_log")
    .insert({
      order_id: orderId,
      from_status: "pending_payment",
      to_status: "paid",
      note: `ECPay ${source}`,
      actor_id: null,
      is_override: false,
    });
  if (logError) {
    console.error("[order_status_log] insert failed", logError);
    Sentry.captureMessage("[order_status_log] insert failed", {
      level: "error",
      extra: { orderId, logError },
    });
  }
}

export async function ensureNotificationSent(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
) {
  // 不依賴呼叫者是否剛推進成功，重新查一次目前狀態：無論是這次才推進、
  // 還是先前已經推進但通知沒寄成功，只要訂單現在確實是 paid 就補寄。
  // 只在 paid 才寄，避免對已取消／退款的訂單誤發「訂單確認」信
  // （目前系統尚無取消／退款通知信，故此處不需要導去別的通知）。
  const { data: order, error } = await serviceRole
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new Error(`ensureNotificationSent failed: ${error.message}`);

  if (order?.status === "paid") {
    await notifyOrderPaid(serviceRole, orderId);
  }
}
