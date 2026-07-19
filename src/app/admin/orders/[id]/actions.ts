"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { AdminActionResult } from "@/lib/admin/action-result";
import { logPiiAccess } from "@/lib/pii/audit";
import { sendOrderShippedNotification } from "@/lib/email/order-shipped-notification";
import { sendOnce } from "@/lib/notification/send-once";
import {
  transitionOrder,
  adminOverrideStatus,
  OrderTransitionRaceError,
  PaidOrderCancelBlockedError,
  type OrderStatus,
} from "@/lib/order/state-machine";
import {
  adminSupportCaseSchema,
  type AdminSupportCaseValues,
} from "@/lib/support/schema";
import type { SupportRequestStatus } from "@/lib/support/support-request";
import { REFRESH_TO_RETRY_SUFFIX } from "@/lib/concurrency-message";
import { issueInvoiceForOrder } from "@/lib/order/issue-invoice";
import {
  refundOrder,
  NoRefundablePaymentError,
  OrderNotRefundableError,
} from "@/lib/order/refund-order";
import { sendOrderRefundedNotification } from "@/lib/email/order-refunded-notification";

// transitionOrder 的 CAS 守衛（T66）代表狀態轉換現在可能因為別的流程（cron
// 自動取消、ECPay webhook）搶先動過而失敗。這種情況不是操作失敗，是頁面顯示
// 的狀態已經過期。回傳契約（結構化 { ok, error }）的緣由見 action-result.ts。
// 注意："use server" 檔案內不可放 `export type { … }` re-export——Turbopack 的
// server actions loader 會在模組載入時對它產生值層級參照，整個 actions 模組
// ReferenceError，所有按鈕全掛。需要這個型別的請直接 import action-result.ts。

const RACE_MESSAGE = `此訂單狀態已被其他流程異動${REFRESH_TO_RETRY_SUFFIX}`;

// 非競態的狀態轉換失敗必須留下遙測（T110 review）：log 寫入失敗現在會
// rollback 整筆轉換並 throw 到這裡——若只回「請稍後再試」，持續性故障
// （如 order_status_log 被未來 migration 的約束擋住）在管理員放棄重試後
// 就完全沒有訊號，ops 無從追查。
function reportAdminTransitionError(
  action: string,
  orderId: string,
  e: unknown,
) {
  console.error(`[admin/orders] ${action} failed`, { orderId }, e);
  Sentry.captureException(e, { extra: { action, orderId } });
}

export async function changeStatus(
  orderId: string,
  to: OrderStatus,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  // 退款不走一鍵轉換（T47）：必須經退款區塊登記（必填原因、翻 payment、寄
  // 退款通知信）。UI 已把 refunded 從快速按鈕濾掉，這裡是 server 端防旁路
  // ——server action 可被直接呼叫，光靠 client 過濾擋不住。
  if (to === "refunded") {
    return {
      ok: false,
      error: "退款請走退款區塊登記（需填原因並確認已於綠界退刷）",
    };
  }
  try {
    await transitionOrder(orderId, to, { actorId: user.id });
  } catch (e) {
    if (e instanceof PaidOrderCancelBlockedError) {
      return {
        ok: false,
        error:
          "此訂單已有付款記錄，不能直接取消；請改走退款流程或 Admin Override",
      };
    }
    if (e instanceof OrderTransitionRaceError) {
      return { ok: false, error: RACE_MESSAGE };
    }
    reportAdminTransitionError("changeStatus", orderId, e);
    return { ok: false, error: "狀態更新失敗，請稍後再試" };
  }
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function shipOrder(
  orderId: string,
  trackingNo: string,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const supabase = createServiceRoleClient();

  // T77：先驗狀態轉換（含 CAS 守衛）再寫 tracking_no。原順序相反——非法轉換
  // （訂單已出貨／取消，或與 cron 競態）拋錯時 tracking_no 已寫入，訂單落在
  // 「有物流單號卻未出貨」的不一致態。轉換失敗即 return，orders 完全未動。
  try {
    await transitionOrder(orderId, "shipped", {
      actorId: user.id,
      note: `出貨：${trackingNo}`,
    });
  } catch (e) {
    if (e instanceof OrderTransitionRaceError) {
      return { ok: false, error: RACE_MESSAGE };
    }
    reportAdminTransitionError("shipOrder", orderId, e);
    return { ok: false, error: "出貨標記失敗，請稍後再試" };
  }

  // 狀態已成功轉 shipped 後才寫單號。此處若失敗（罕見暫時性 DB 錯），訂單
  // 已是 shipped、僅缺單號——回 warning 提示操作者用「修正物流單號」補填，
  // 不回 error（會誤導成「出貨沒成功」，實際已 shipped）。單號未寫入時通知
  // 信也不寄（sendOrderShippedNotification 見 tracking_no 為空即跳過）。
  const { error: trackingError } = await supabase
    .from("orders")
    .update({ tracking_no: trackingNo })
    .eq("id", orderId);

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");

  if (trackingError) {
    return {
      ok: true,
      warning:
        "已標記出貨，但物流單號寫入失敗——請用下方「修正物流單號」補填，客人才會收到含單號的通知",
    };
  }

  // 出貨已成功寫入 DB，寄信只是 best-effort 通知：sendOnce 保證絕不往外拋
  // 例外（不擋出貨操作），且用 notification(order_id, type) 的 unique 約束
  // 去重——雙擊出貨按鈕不會重複寄信。寄失敗以 warning 讓操作者知情（T88：
  // 不再靜默丟棄結果），每日 reconcile sweep 會自動補寄。
  const notified = await sendOnce(supabase, {
    orderId,
    type: "order_shipped",
    send: () => sendOrderShippedNotification(orderId),
  });

  if (!notified) {
    return {
      ok: true,
      warning: "出貨已完成，但通知信寄送失敗——系統每日會自動重試補寄",
    };
  }
  return { ok: true };
}

// reason 會進 order_status_log.note 與 Sentry payload：限長防誤貼大段內容，
// 與 refund-section.tsx／override 表單的 textarea maxLength 保持一致。override
// 與退款登記共用此上限。
const STATUS_REASON_MAX_LENGTH = 500;

export async function overrideStatus(
  orderId: string,
  to: OrderStatus,
  reason: string,
): Promise<AdminActionResult> {
  const user = await requireAdmin();

  // 伺服器端驗 reason（非空＋限長）：override 是繞過狀態機的高權限操作（含退款
  // 逃生口），稽核 note 必須有內容。client handleOverride 已擋，但 server action
  // 可被直接呼叫，光靠 client 過濾會留下「空稽核 note 的狀態覆寫」旁路。
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { ok: false, error: "請填寫強制改狀態的原因" };
  }
  if (trimmedReason.length > STATUS_REASON_MAX_LENGTH) {
    return {
      ok: false,
      error: `原因請勿超過 ${STATUS_REASON_MAX_LENGTH} 字`,
    };
  }

  try {
    await adminOverrideStatus(orderId, to, {
      operatorId: user.id,
      reason: trimmedReason,
    });
  } catch (e) {
    if (e instanceof OrderTransitionRaceError) {
      return { ok: false, error: RACE_MESSAGE };
    }
    reportAdminTransitionError("overrideStatus", orderId, e);
    return { ok: false, error: "強制改狀態失敗，請稍後再試" };
  }
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

// T47 記錄式退款：實際刷退由管理者先在綠界廠商後台人工完成，這裡只登記
// 結果——refundOrder 翻 payment＋orders（冪等），成功後 best-effort 寄退款
// 通知信（sendOnce 去重＋每日 reconcile sweep 補寄）。
// 命名 refundOrderAction（比照 issueInvoiceAction）：與 import 進來的 lib
// 函式 refundOrder 同名會撞。
export async function refundOrderAction(
  orderId: string,
  reason: string,
): Promise<AdminActionResult> {
  const user = await requireAdmin();

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { ok: false, error: "請填寫退款原因" };
  }
  if (trimmedReason.length > STATUS_REASON_MAX_LENGTH) {
    return {
      ok: false,
      error: `退款原因請勿超過 ${STATUS_REASON_MAX_LENGTH} 字`,
    };
  }

  try {
    await refundOrder(orderId, { actorId: user.id, reason: trimmedReason });
  } catch (e) {
    if (e instanceof NoRefundablePaymentError) {
      return { ok: false, error: "此訂單無已收款記錄，無法退款" };
    }
    if (e instanceof OrderNotRefundableError) {
      // pre-guard：pending_payment／cancelled 等狀態不可走記錄式退款（這類
      // 單屬 ops-runbook §6.1 人工裁決）。UI 已隱藏按鈕，這裡擋 server action
      // 直接呼叫＋頁面過期的情境。
      return {
        ok: false,
        error: `訂單目前狀態不可退款（${e.currentStatus}），請重新整理頁面確認`,
      };
    }
    if (e instanceof OrderTransitionRaceError) {
      return { ok: false, error: RACE_MESSAGE };
    }
    reportAdminTransitionError("refundOrder", orderId, e);
    return { ok: false, error: "退款登記失敗，請稍後再試" };
  }

  // 退款本體已成功寫入 DB，寄信只是 best-effort 通知：sendOnce 保證不往外
  // 拋例外，且以 notification(order_id, type) unique 去重——重複操作不會重複
  // 寄信。寄失敗以 warning 讓操作者知情，每日 reconcile sweep 自動補寄
  // （order_refunded 已登記於 NOTIFICATION_SENDERS）。
  const supabase = createServiceRoleClient();
  const notified = await sendOnce(supabase, {
    orderId,
    type: "order_refunded",
    send: () => sendOrderRefundedNotification(orderId),
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath(`/account/orders/${orderId}`);
  if (!notified) {
    return {
      ok: true,
      warning: "退款已登記，但通知信寄送失敗——系統每日會自動重試補寄",
    };
  }
  return { ok: true };
}

export async function revealOrderPii(orderId: string): Promise<{
  recipientName: string;
  recipientPhone: string;
  email: string | null;
  shippingAddress: string;
}> {
  const user = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("recipient_name, recipient_phone, shipping_address, member(email)")
    .eq("id", orderId)
    .single();

  if (error || !order) throw new Error("找不到訂單");

  // 完整個資離開伺服器前必記稽核 log（T64/T80）；寫入失敗 fail closed，不回傳 PII
  await logPiiAccess({
    actorId: user.id,
    actorEmail: user.email ?? "",
    orderId,
    fields: ["recipient_name", "recipient_phone", "email", "shipping_address"],
  });

  const member = order.member as { email: string } | null;
  return {
    recipientName: order.recipient_name,
    recipientPhone: order.recipient_phone,
    email: member?.email ?? null,
    shippingAddress: order.shipping_address,
  };
}

export async function saveTrackingNo(orderId: string, trackingNo: string) {
  await requireAdmin();
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("orders")
    .update({ tracking_no: trackingNo })
    .eq("id", orderId);

  if (error) throw new Error(`更新物流單號失敗：${error.message}`);
  revalidatePath(`/admin/orders/${orderId}`);
}

const SUPPORT_STATUSES: SupportRequestStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "rejected",
];

export async function updateSupportRequestStatus(
  requestId: string,
  status: SupportRequestStatus,
) {
  await requireAdmin();
  if (!SUPPORT_STATUSES.includes(status)) throw new Error("不合法的狀態");

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("support_request")
    .update({ status })
    .eq("id", requestId)
    .select("order_id")
    .single();

  if (error || !data) throw new Error("更新售後申請狀態失敗");

  revalidatePath(`/admin/orders/${data.order_id}`);
  revalidatePath(`/account/orders/${data.order_id}`);
  revalidatePath(`/account/orders/${data.order_id}/support`);
}

export async function createSupportCaseByAdmin(
  orderId: string,
  values: AdminSupportCaseValues,
) {
  await requireAdmin();

  const result = adminSupportCaseSchema.safeParse(values);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "表單格式不正確");
  }

  const supabase = createServiceRoleClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("member_id")
    .eq("id", orderId)
    .single();

  if (orderError || !order) throw new Error("找不到訂單");

  // 店家自己登錄的案件，不寄店家通知信
  const { error } = await supabase.from("support_request").insert({
    order_id: orderId,
    member_id: order.member_id,
    request_type: result.data.requestType,
    description: result.data.description,
  });

  if (error) throw new Error("建立售服案件失敗");

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/account/orders/${orderId}`);
  revalidatePath(`/account/orders/${orderId}/support`);
}

// T42：後台手動補開發票——與 webhook 自動開立（ensureInvoiceIssued）共用同一支
// issueInvoiceForOrder，天生冪等。這是藍圖鐵律「發票失敗不阻塞金流」的補償
// 入口：webhook 那次失敗只會記 Sentry，管理員看到告警後回這裡按按鈕重試。
export async function issueInvoiceAction(
  orderId: string,
): Promise<AdminActionResult> {
  await requireAdmin();

  const serviceRole = createServiceRoleClient();
  const result = await issueInvoiceForOrder(serviceRole, orderId);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}
