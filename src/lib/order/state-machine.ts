import "server-only";
import * as Sentry from "@sentry/nextjs";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { type OrderStatus, VALID_TRANSITIONS } from "@/lib/order/order-status";
import { findPaidPayment } from "@/lib/order/find-paid-payment";

export type { OrderStatus };
export { VALID_TRANSITIONS };

// 呼叫端（如 pending-payment-expire cron）需要區分「這筆訂單已經被其他流程
// 動過，跳過即可」跟「真的失敗」——比照 query-trade-info.ts 的 RateLimitError
// 慣例，用具名 Error 子類別＋instanceof 判斷，取代字串 code 手刻型別斷言。
export class OrderTransitionRaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderTransitionRaceError";
  }
}

// 「訂單已有已收款 payment，不得取消」的守衛被觸發時拋出。取消不可逆、且會
// 觸發 T66 生命週期後續——錢已收在訂單上卻被取消，是唯一「錢收了卻可能靜默
// 消失」的路徑。這條 invariant 集中在 transitionOrder（所有取消路徑的必經
// 之地），呼叫端據此 instanceof 分流：逾期 cron 計 paidConflict＋告警、結帳
// 流程回錯誤不建新單（防雙重扣款）、admin 導去退款流程。
export class PaidOrderCancelBlockedError extends Error {
  constructor(orderId: string) {
    super(`訂單已有已收款 payment，不得取消：${orderId}`);
    this.name = "PaidOrderCancelBlockedError";
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// 正常流程：受狀態機約束。
// 讀取現有狀態 → canTransition 驗證 → UPDATE orders → INSERT order_status_log。
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  options?: { note?: string; actorId?: string },
): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) {
    throw new Error(`訂單不存在：${orderId}`);
  }

  const from = order.status as OrderStatus;

  if (!canTransition(from, to)) {
    // 呼叫端（尤其是 cron／webhook）挑選候選當下 status 符合預期，但真正執行
    // 到這裡時 status 已被別的流程搶先動過——不是呼叫端邏輯錯誤，是良性競態。
    throw new OrderTransitionRaceError(`非法狀態轉換：${from} → ${to}`);
  }

  // 取消守衛（所有取消路徑的必經之地）：錢已收在訂單上就絕不取消。webhook 側
  // 卡單（payment=paid／orders 仍 pending_payment，見 ops-runbook §1.1 第④類）
  // 交給 reconcile 漂移臂隔日冪等推進，不可被逾期取消／改單／admin 誤取消而
  // 造成「錢在已取消訂單上」＋（結帳流程）重新建單雙重扣款。
  if (to === "cancelled") {
    const paidBefore = await findPaidPayment(supabase, orderId);
    if (paidBefore) throw new PaidOrderCancelBlockedError(orderId);
  }

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", from)
    .select("id")
    .maybeSingle();

  if (updateError) throw new Error(`訂單狀態更新失敗：${updateError.message}`);
  if (!updated) {
    throw new OrderTransitionRaceError(`訂單狀態已被其他流程異動：${orderId}`);
  }

  // TOCTOU 補洞：pre-guard 查完之後、CAS 取消 commit 之前的毫秒窄窗內 webhook
  // 才把 payment 翻 paid（且該次 ensureOrderPaid 失敗＋ECPay 重送耗盡）——主
  // 對帳臂（鍵 payment=pending）與漂移臂（鍵 orders=pending_payment）都撈不到。
  // 取消 commit「之後」再查一次即偵測到；放在 log insert 之前，即使 log 寫入
  // 失敗（下方 throw）也已發過告警。偵測即可（修復走 ops-runbook §6.1 人工
  // 裁決）；durable 兜底＝reconcile 每日 recurring 稽核臂（payment=paid ∧
  // orders=cancelled）。查詢失敗只降級 warning，不影響已完成的取消。
  if (to === "cancelled") {
    try {
      const paidAfter = await findPaidPayment(supabase, orderId);
      if (paidAfter) {
        Sentry.captureMessage(
          "transitionOrder: money received on order cancelled during transition",
          { level: "error", extra: { orderId } },
        );
      }
    } catch (e) {
      Sentry.captureMessage("transitionOrder: post-cancel paid check failed", {
        level: "warning",
        extra: {
          orderId,
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }

  const { error: logError } = await supabase.from("order_status_log").insert({
    order_id: orderId,
    from_status: from,
    to_status: to,
    note: options?.note ?? null,
    actor_id: options?.actorId ?? null,
    is_override: false,
  });

  if (logError) throw new Error(`狀態 log 寫入失敗：${logError.message}`);
}

// Admin override：繞過狀態機，可將訂單改為任意狀態。
// operatorId（member.id）與 reason 必填，確保稽核記錄完整。
export async function adminOverrideStatus(
  orderId: string,
  to: OrderStatus,
  options: { operatorId: string; reason: string },
): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) {
    throw new Error(`訂單不存在：${orderId}`);
  }

  const from = order.status as OrderStatus;

  // to === from 時 SET 不會改動 WHERE 用到的 status 欄位，CAS 守衛在 Postgres
  // READ COMMITTED 下會失效（EvalPlanQual 重新檢查條件仍會命中，CLAUDE.md
  // §6）——兩個並發的「覆寫成同一個狀態」都會通過、都寫入稽核記錄。與其讓
  // CAS 守衛在這個 edge case 悄悄失效，不如直接判定「目標與現況相同」不是
  // 有意義的覆寫操作，提前擋下、完全不碰 UPDATE。
  if (to === from) {
    throw new Error(`目標狀態與目前狀態相同（${to}），無需覆寫`);
  }

  // Override 語意仍是「任意目標」（不受 VALID_TRANSITIONS 約束），但加上
  // .eq("status", from) 條件式守衛確保雙擊或兩位管理者近乎同時對同一單送出
  // 互斥的 override 目標時只有一筆會成功、只寫一筆 order_status_log——否則
  // 兩者都會通過（本來就不檢查 canTransition）、都寫入稽核記錄，產生同一單
  // 被記成兩段矛盾轉換的財務稽核缺口（T92／F-007）。
  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", from)
    .select("id")
    .maybeSingle();

  if (updateError) throw new Error(`訂單狀態更新失敗：${updateError.message}`);
  if (!updated) {
    throw new OrderTransitionRaceError(`訂單狀態已被其他流程異動：${orderId}`);
  }

  const { error: logError } = await supabase.from("order_status_log").insert({
    order_id: orderId,
    from_status: from,
    to_status: to,
    note: options.reason,
    actor_id: options.operatorId,
    is_override: true,
  });

  if (logError) throw new Error(`稽核 log 寫入失敗：${logError.message}`);
}
