import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ensureOrderPaid,
  ensureNotificationSent,
} from "@/lib/order/ensure-paid";
import { markPendingPaymentsFailed } from "@/lib/order/mark-pending-payments-failed";
import { issueInvoiceForOrder } from "@/lib/order/issue-invoice";
import {
  queryTradeInfo,
  RateLimitError,
  QueryTradeInfoHttpError,
} from "@/lib/ecpay/query-trade-info";
import { validateSettleAmount } from "@/lib/ecpay/validate-settle-amount";
import { requireCronAuth } from "@/lib/cron/require-cron-auth";
import { redis } from "@/lib/redis";
import { sendOnce } from "@/lib/notification/send-once";
import { NOTIFICATION_SENDERS } from "@/lib/notification/senders";
import type { OrderStatus } from "@/lib/order/order-status";

// serverless function 最長執行時間：主迴圈＋漂移臂＋通知／發票 sweep 逐筆
// 400ms 節流，滿批最壞情況約需上百秒；設 300s 避免平台預設過低時中途被砍
// （漂移臂推進到一半被中斷會延後自癒，見各 sweep 的冪等註解）。
export const maxDuration = 300;

// 主候選單輪容量上限。容量假設（明碼化，T102）：正常運作下 pending payment
// 積壓應遠低於此——每筆最壞約 1.4s（ECPay 往返＋400ms 節流），30 筆≈45s，對
// maxDuration=300s 有約 6 倍餘裕。pending 積壓「持續」逼近／撈滿 30 筆不是對帳
// 容量問題，而是 webhook 大面積失靈（付款回呼沒進來）的 P0 事故訊號——真正的
// 修復在 webhook 端（ops-runbook §1.1），對帳只是安全網。故撈滿時發 warning
// 當早期預警（見主候選查詢後的 candidatesSaturated 判定），而非放大批量硬撐。
const CANDIDATE_LIMIT = 30;
const MIN_AGE_MS = 10 * 60 * 1000;
// 冷卻必須明顯短於 cron 週期（每日一次）：last_reconciled_at 的蓋章時間晚於
// cron 起跑（前面候選每筆 400ms 節流＋ECPay 往返），若冷卻＝24h，隔日 cron 的
// cutoff（now−24h）會差幾秒到幾分鐘而撈不到同一筆，「隔日重試」實際變隔兩日。
// T107 之後這個冷卻從「告警去重」升級為「失敗自癒的重試節奏」，20h 用來吸收
// cron jitter＋整批處理時間。注意：此值與「每日一次」的排程頻率耦合——改排程
// （T126 小時級）必須連動改這裡（規則與連動清單見 tasks.csv T126 說明欄），
// 兩者相距僅一個檔案內常數與外部設定，不另加程式防呆。
const RECONCILE_COOLDOWN_MS = 20 * 60 * 60 * 1000;
const THROTTLE_MS = 400;
const SWEEP_LIMIT = 20;
const DRIFT_LIMIT = 20;

// 連續 403 計數（跨排程持久化於 Redis）。ECPay 限流實測回 403（ops-runbook），
// 但持續性 403 也可能是金鑰／CheckMacValue 失效——偶發 403 當限流退避即可，
// 連續 N 次都撈不到任何一筆成功回應才升級 error，避免對正常節流狂告警。
const CONSECUTIVE_403_KEY = "reconcile:consecutive-403";
const CONSECUTIVE_403_ERROR_THRESHOLD = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function markReconciled(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  paymentId: string,
) {
  const { error } = await serviceRole
    .from("payment")
    .update({ last_reconciled_at: new Date().toISOString() })
    .eq("id", paymentId);

  // 跟其他 Supabase 呼叫一樣必須檢查 { error }：漏檢查的話，這筆的對帳冷卻
  // 紀錄（RECONCILE_COOLDOWN_MS）悄悄沒寫入，隔天同一筆又會被撈出來重新告警。
  if (error) {
    console.error("[ecpay-reconcile] last_reconciled_at update failed", error);
    Sentry.captureMessage("reconcile: last_reconciled_at update failed", {
      level: "error",
      extra: { paymentId, error: error.message },
    });
  }
}

// T88 過渡版兜底：每天掃 notification.status='failed' 補寄。ECPay webhook
// 重送（快路徑）額度有限且可能被各種情況提前終止；有這個 sweep 在，「寄信
// 失敗」的最壞情況從「永久遺失」降為「延遲至下一個 cron 週期」。重試頻率
// 天然被 cron 排程（每日一次）限制，故不需要嘗試次數上限——永久性失敗
//（客人 email 打錯等）會每天重試失敗＋告警一次，連續多日同一筆告警＝該
// 人工介入（ops-runbook）；失敗分類＋次數上限的完整版需加欄位，登記為
// 獨立技術債任務。
// 回傳 false＝查詢失敗（呼叫端據此讓整支 cron fail-visible 回 500，理由同
// 漂移臂）。正常跑完（含無事可補）回 true。
async function sweepFailedNotifications(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  summary: Summary,
): Promise<boolean> {
  const { data: failedRows, error } = await serviceRole
    .from("notification")
    .select("id, order_id, type")
    .eq("status", "failed")
    .order("created_at", { ascending: true })
    .limit(SWEEP_LIMIT);

  if (error) {
    console.error("[ecpay-reconcile] failed-notification 查詢失敗", error);
    Sentry.captureMessage("reconcile: notification sweep query failed", {
      level: "error",
      extra: { error: error.message },
    });
    return false;
  }
  if (!failedRows || failedRows.length === 0) return true;

  // 批次撈訂單狀態做適寄判斷（不依賴 FK embed，兩段查詢即可）。
  const orderIds = [...new Set(failedRows.map((r) => r.order_id))];
  const { data: orders, error: ordersError } = await serviceRole
    .from("orders")
    .select("id, status")
    .in("id", orderIds);

  if (ordersError) {
    console.error("[ecpay-reconcile] sweep 訂單狀態查詢失敗", ordersError);
    Sentry.captureMessage("reconcile: sweep order-status query failed", {
      level: "error",
      extra: { error: ordersError.message },
    });
    return false;
  }
  const statusById = new Map((orders ?? []).map((o) => [o.id, o.status]));

  for (const row of failedRows) {
    const sender = NOTIFICATION_SENDERS[row.type];
    const orderStatus = statusById.get(row.order_id);
    if (
      !sender ||
      !orderStatus ||
      !sender.eligibleStatuses.includes(orderStatus as OrderStatus)
    ) {
      // 未登記的通知類型／訂單已取消退款／查無訂單：不重寄。這類 row 會
      // 一直留在 failed 被每天撈到又跳過，屬可接受的低頻噪音；真要清理走
      // 人工（ops-runbook）。
      continue;
    }

    summary.sweepRetried += 1;
    // sendOnce 走 conflict → failed reclaim → attemptSend，天然去重且與
    // webhook 端的並發重試互斥，這裡不需要額外鎖。
    const ok = await sendOnce(serviceRole, {
      orderId: row.order_id,
      type: row.type,
      send: () => sender.send(row.order_id),
    });
    if (ok) {
      summary.sweepSent += 1;
    } else {
      summary.sweepStillFailing += 1;
      // 每日一筆的「還在失敗」訊號：連續多日出現同一 orderId+type＝多半是
      // 永久性失敗（email 打錯、網域限制），該人工介入。
      Sentry.captureMessage("reconcile: notification still failing", {
        level: "warning",
        extra: { orderId: row.order_id, type: row.type },
      });
    }
    // 節流：對 Resend 的呼叫比照主迴圈對 ECPay 的禮貌。
    await sleep(THROTTLE_MS);
  }
  return true;
}

type Summary = {
  checked: number;
  promoted: number;
  // T127②：漂移臂（payment=paid／orders=pending_payment 的 webhook 側卡單）
  // 的候選數與實際推進數——driftPromoted 每一筆都代表 webhook 的 settlePaid
  // 半路失敗過，是 webhook 可靠度訊號（比照 promoted 慣例）。
  driftChecked: number;
  driftPromoted: number;
  // 漂移臂撈到的筆數觸及 DRIFT_LIMIT：可能還有更多漂移單被截掉、留待隔日，
  // 不再無聲（大面積 webhook 失靈時 backlog 累積需人工關注，ops-runbook §1.1）。
  driftTruncated: boolean;
  // 錢確認收到，但訂單處於 cancelled／refunded 等已關閉狀態（ensureOrderPaid
  // 回報 closed）——與 promoted（健康搶救）分流，這是「錢收在已關閉訂單上」
  // 的獨立訊號，須走人工裁決：退款或恢復訂單（ops-runbook §6.1）。
  promotedOnClosedOrder: number;
  // recurring 稽核臂：payment=paid ∧ orders=cancelled 的漂移單（取消守衛的
  // TOCTOU 窄窗、或 T127 部署前既有列）。主臂（鍵 payment=pending）與漂移臂
  //（鍵 orders=pending_payment）都撈不到，這是它的 durable 兜底——不靠單次
  // Sentry，每日查得到就每日告警走人工裁決（ops-runbook §6.1）。
  paidOnCancelled: number;
  // 稽核臂撈到超過 DRIFT_LIMIT：大面積事故時 backlog 超出單輪量，需人工關注。
  paidOnCancelledTruncated: boolean;
  // recurring 稽核臂（T47）：payment=paid ∧ orders=refunded 的漂移單。成因＝
  // Admin Override 直接把訂單改 refunded（逃生口，不翻 payment、不寄信），
  // 或 legacy 半套。三個既有臂（鍵 payment=pending／orders=pending_payment／
  // orders=cancelled）都撈不到，唯一訊號原本只有逐單開啟才顯示的 needsPaymentRepair
  // UI——非 durable。這支每日查得到就告警走人工裁決（管理者回退款區塊按「補登記
  // 退款」補翻 payment＋補寄信，ops-runbook §6.1）。
  paidOnRefunded: number;
  paidOnRefundedTruncated: boolean;
  // 主候選查詢撈滿 CANDIDATE_LIMIT（T102）：pending 積壓逼近單輪容量＝webhook
  // 大面積失靈的早期訊號（成因與修復在 webhook 端，非對帳，見 CANDIDATE_LIMIT
  // 註解）。與 driftTruncated 等 backlog 旗標同慣例：summary 旗標＋Sentry 並存。
  candidatesSaturated: boolean;
  mismatches: number;
  failed: number;
  unexpected: number;
  // 通知信投遞失敗獨立計數，不塞 unexpected——unexpected 已承載查詢例外／
  // 金額異常等資料面訊號，混裝會讓日報無法分辨「資料異常」與「郵件故障」
  //（T88 review）。
  notifyFailed: number;
  // failed-notification sweep（T88 過渡版兜底）的成果統計。
  sweepRetried: number;
  sweepSent: number;
  sweepStillFailing: number;
  rateLimited: boolean;
  // T99：HTTP 層失敗（ECPay 5xx 等，非限流）導致的整批中止，與 rateLimited
  // 分開標示——語意不同（對方故障 vs 我方打太快），Sentry 告警也分流。
  httpAborted: boolean;
  invoicesSwept: number;
  invoicesIssued: number;
  invoicesFailed: number;
};

// NULL-tolerant「欄位為 null 或早於 cutoff」的 PostgREST .or() 過濾字串單一
// 出處（主臂的 last_reconciled_at 冷卻閘門、漂移臂的 paid_at 年齡閘門共用）。
// timestamp 值必須雙引號包住——.or() 用句點分隔「欄位.運算子.值」，值裡的
// 句點（ISO 毫秒）／逗號會被誤解析（曾在 sandbox 端到端驗證實測到候選對不上、
// 漏掉明確符合的資料）。這條規則踩過真實 bug 才寫對，只留一份供各查詢 import，
// 禁止各自手抄複本失同步。
function nullOrBefore(column: string, cutoffIso: string) {
  return `${column}.is.null,${column}.lt."${cutoffIso}"`;
}

// 單筆候選「非預期失敗」的共用出口：計數＋Sentry exception。主迴圈與漂移臂
// （reconcileDriftedOrders）共用同一份，避免兩處 extra payload／計數語意漂移。
// 已知取捨：同一筆候選一輪內可能計到 2 次 unexpected（主臂②的 CAS {error}
// 與③的 throw 各記一次）——兩個獨立故障本來就是兩個訊號，去重需額外狀態、
// 弊大於利，維持雙計（PR #67 review 拍板）。
function recordUnexpected(
  summary: Summary,
  e: unknown,
  payment: { order_id: string; merchant_trade_no: string },
) {
  summary.unexpected += 1;
  Sentry.captureException(e, {
    extra: {
      orderId: payment.order_id,
      merchantTradeNo: payment.merchant_trade_no,
    },
  });
}

// 「錢收在已關閉訂單上」的共用出口（主迴圈與漂移臂共用單一出處，避免兩處
// 計數語意／Sentry 訊息字串漂移——runbook §6.1 與測試都比對這個字串）。
function recordClosedOrder(
  summary: Summary,
  payment: { order_id: string; merchant_trade_no: string },
) {
  summary.promotedOnClosedOrder += 1;
  Sentry.captureMessage("reconcile: money received on closed order", {
    level: "error",
    extra: {
      orderId: payment.order_id,
      merchantTradeNo: payment.merchant_trade_no,
    },
  });
}

// 通知信投遞失敗的共用出口（主迴圈與漂移臂共用單一出處，理由同上）。
function recordNotifyFailed(
  summary: Summary,
  payment: { order_id: string; merchant_trade_no: string },
) {
  summary.notifyFailed += 1;
  Sentry.captureMessage("reconcile: notification delivery failed", {
    level: "warning",
    extra: {
      orderId: payment.order_id,
      merchantTradeNo: payment.merchant_trade_no,
    },
  });
}

// T127②：webhook 側卡單（payment=paid／orders=pending_payment）的第二候選臂。
// 主迴圈的候選鍵是 payment.status='pending'，撈不到這種漂移——它是 webhook 端
// settlePaid「先翻 payment、再推進訂單」半路失敗＋ECPay 重送耗盡的產物，若不
// 處理則不自癒、且錢收了沒有任何自動告警（ops-runbook §1.1 第④類）。
// 故意不打 ECPay：payment=paid 是當初驗章＋金額核對通過後才寫入的財務事實，
// 直接信任即可；也因此本臂不受 queryTradeInfo 的 rate limit 影響——僅限主迴圈
// 被 RateLimitError 中斷（break）的情況本臂照跑；主候選查詢若回 {error} 會
// throw→500，本臂與後續 sweep 當天同樣被跳過（非本臂可救，隔日 cron 再來）。
// 每筆 sleep(THROTTLE_MS) 保留，禮貌對象是 ensureNotificationSent 背後的 Resend。
// 訂單已推進成 paid 後，把它其餘的 pending payment 一併標成 failed：客人可能
// 產生過多張付款連結（pay page 標舊 pending 為 failed 後另建 pending，T74），
// 回傳 false＝候選查詢失敗（呼叫端據此讓整支 cron 回 HTTP 500，讓監控看得到
// 紅燈，而非把「漂移臂靜默沒跑」誤看成綠燈——對齊 expire route 的 fail-visible
// 理由；漂移臂是 webhook 側卡單的指定自癒者，它 dead 必須告警）。
async function reconcileDriftedOrders(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  summary: Summary,
): Promise<boolean> {
  const now = Date.now();
  const maxPaidAt = new Date(now - MIN_AGE_MS).toISOString();

  // inner embed 過濾 orders.status，只撈漂移單。年齡閘門必須 NULL-tolerant：
  // 不可用 .lt("paid_at", cutoff)——PostgREST 中 NULL < ts 為假，會永久靜默
  // 排除 paid_at IS NULL 的 paid 列。ops-runbook §1 步驟 3 的人工修 SQL
  // （UPDATE payment SET status='paid', gateway_trade_no=... 不寫 paid_at）
  // 正會產生這種列，加上取消守衛又擋住逾期取消，會卡 pending_payment 永不
  // 自癒——正是本臂要關掉的盲點。code 寫入的 paid 列一律同時寫 paid_at，故
  // NULL⟹人工列⟹立即處理安全（本查詢已用 orders.status='pending_payment'
  // 過濾，只會撈到真正卡住的單）。MIN_AGE_MS 只壓非 NULL 分支：避免撈到
  // webhook 正在 settle 中的單（payment 剛翻、訂單推進 in-flight）。
  // timestamp 值必須雙引號包住（nullOrBefore helper 的註解記載 PostgREST 陷阱）。
  //
  // 刻意不套主臂的 last_reconciled_at 冷卻閘門：本臂 idempotent（ensureOrderPaid
  // 走 CAS），推進成功後訂單即離開候選集（orders.status≠pending_payment），
  // 天然收斂——不需冷卻去重。共用主臂的冷卻反而有害：主臂處理該 payment 仍
  // pending 時蓋的章，會讓它稍後翻 paid 成漂移單後被冷卻排除，延後一天自癒。
  const { data: drifted, error } = await serviceRole
    .from("payment")
    .select("id, order_id, merchant_trade_no, orders!inner(status)")
    .eq("status", "paid")
    .eq("orders.status", "pending_payment")
    .or(nullOrBefore("paid_at", maxPaidAt))
    // nullsFirst 必加：Postgres ASC 預設 NULLS LAST，會把上面特意保留的
    // paid_at IS NULL 人工列排到最後——漂移列 ≥ DRIFT_LIMIT（大面積 webhook
    // 失靈）時被截掉，「立即處理」的意圖被排序默默推翻；NULL 排最前才與
    // 年齡閘門的 NULL-tolerant 設計一致。
    .order("paid_at", { ascending: true, nullsFirst: true })
    // 多撈一筆（+1）以精準偵測截斷：撈到 > DRIFT_LIMIT 才代表真有 backlog，
    // 避免「恰好等於上限、後面沒有更多」誤觸 backlog 告警（本輪只處理前
    // DRIFT_LIMIT 筆，多撈的那筆下輪再處理）。
    .limit(DRIFT_LIMIT + 1);

  if (error) {
    Sentry.captureMessage("reconcile: drifted-order 候選查詢失敗", {
      level: "error",
      extra: { error: error.message },
    });
    return false;
  }

  const driftRows = (drifted ?? []).slice(0, DRIFT_LIMIT);
  // 撈到超過上限＝還有更多漂移單留待隔日；不再無聲（大面積 webhook 失靈的
  // backlog 需人工關注，ops-runbook §1.1）。
  if ((drifted?.length ?? 0) > DRIFT_LIMIT) {
    summary.driftTruncated = true;
    Sentry.captureMessage("reconcile: drift backlog may exceed limit", {
      level: "warning",
      extra: { driftLimit: DRIFT_LIMIT },
    });
  }

  for (const payment of driftRows) {
    // 凡入選必計、進迴圈第一行就計（不論後續成敗），日報才能對出
    // 「撈到幾筆 vs 救活幾筆」。
    summary.driftChecked += 1;

    try {
      // source 用獨立字串，order_status_log.note 稽核可辨識是漂移臂救的。
      const orderResult = await ensureOrderPaid(
        serviceRole,
        payment.order_id,
        "reconcile-drift",
      );

      if (orderResult === "promoted") {
        summary.driftPromoted += 1;
        Sentry.captureMessage("reconcile: promoted webhook-side stuck order", {
          level: "warning",
          extra: {
            orderId: payment.order_id,
            merchantTradeNo: payment.merchant_trade_no,
          },
        });
        // 推進成功：清掉該訂單其餘 pending payment 殘留（見函式註解）。
        await markPendingPaymentsFailed(serviceRole, payment.order_id);
      } else if (orderResult === "closed") {
        // 撞上取消競態：錢收在已關閉訂單上——共用主迴圈的計數與訊息，
        // 走人工裁決（ops-runbook §6.1）。
        recordClosedOrder(summary, payment);
      } else if (orderResult === "already-settled") {
        // 候選查詢後才被別人推進（webhook 遲到的重送等）——不是本臂的搶救、
        // 不計 driftPromoted，但訂單既已 paid，同樣清掉殘留 pending payment，
        // 否則它會一直卡在主臂候選集。
        await markPendingPaymentsFailed(serviceRole, payment.order_id);
      }
      // indeterminate：ensureOrderPaid 內已發 P0，保守不動作、不清 sibling。

      // 補寄通知：卡單期間確認信一定沒寄過（訂單當時還不是 paid）。
      const notified = await ensureNotificationSent(
        serviceRole,
        payment.order_id,
      );
      if (!notified) {
        recordNotifyFailed(summary, payment);
      }
    } catch (e) {
      // 單筆失敗不拖垮整批；本臂 idempotent，隔日候選集仍含此單自動重試。
      // 共用主臂的 recordUnexpected（計數＋Sentry extra 單一出處）。
      recordUnexpected(summary, e, payment);
    }

    await sleep(THROTTLE_MS);
  }
  return true;
}

// recurring 稽核臂（durable 兜底）：payment=paid ∧ orders 已進終態——錢掛在已
// 關閉訂單上。主臂（鍵 payment=pending）與漂移臂（鍵 orders=pending_payment）
// 都撈不到，若只靠事件當下的單次 Sentry，漏看就永遠無聲；這支每日查得到就
// 告警，升級為 durable 復發偵測，走人工裁決（ops-runbook §6.1）。post-guard 下
// 集合恆近乎空，量體 ~0。回傳 false＝查詢失敗（讓整支 cron fail-visible 回 500）。
//
// 兩個終態共用同一套查詢/截斷/告警邏輯，只差 orders.status 常值、Summary 欄位
// 與 Sentry 訊息字串——參數化避免兩支同性質 P0 金流告警日後改一處另一處靜默
// 分歧（cancelled＝取消守衛 TOCTOU／T127 前既有列；refunded＝Admin Override
// 逃生口不翻 payment 或 legacy 半套）。
async function auditPaidOnClosedOrders(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  summary: Summary,
  config: {
    orderStatus: "cancelled" | "refunded";
    countKey: "paidOnCancelled" | "paidOnRefunded";
    truncatedKey: "paidOnCancelledTruncated" | "paidOnRefundedTruncated";
    queryFailMessage: string;
    truncateMessage: string;
    driftMessage: string;
  },
): Promise<boolean> {
  const { data: rows, error } = await serviceRole
    .from("payment")
    .select("id, order_id, merchant_trade_no, orders!inner(status)")
    .eq("status", "paid")
    .eq("orders.status", config.orderStatus)
    // 穩定排序：無 .order() 時 PostgREST 每輪可能回不同的 20 筆，害同一筆卡單
    // 在告警集裡進出跳動；固定以 paid_at 升序（最早的錢最該先處理）。多撈一筆
    // 精準偵測截斷（大面積事故 > DRIFT_LIMIT 時不可無聲）。
    .order("paid_at", { ascending: true, nullsFirst: true })
    .limit(DRIFT_LIMIT + 1);

  if (error) {
    Sentry.captureMessage(config.queryFailMessage, {
      level: "error",
      extra: { error: error.message },
    });
    return false;
  }

  if ((rows?.length ?? 0) > DRIFT_LIMIT) {
    summary[config.truncatedKey] = true;
    Sentry.captureMessage(config.truncateMessage, {
      level: "error",
      extra: { limit: DRIFT_LIMIT },
    });
  }

  for (const payment of (rows ?? []).slice(0, DRIFT_LIMIT)) {
    summary[config.countKey] += 1;
    Sentry.captureMessage(config.driftMessage, {
      level: "error",
      extra: {
        orderId: payment.order_id,
        merchantTradeNo: payment.merchant_trade_no,
      },
    });
  }
  return true;
}

const INVOICE_SWEEP_LIMIT = 20;

// T42：「已付款未開票」每日 sweep（藍圖 07-invoice.md §6 明訂的核對項）——
// webhook 那次開立失敗（ECPay 暫時性故障、after() 執行環境被提早回收等）的
// 自動補開防線；issueInvoiceForOrder 冪等（issued 短路＋GetIssue 判別），
// 與 webhook／後台補開共用同一支，重跑安全。
// 回傳 false＝查詢失敗（呼叫端據此讓整支 cron fail-visible 回 500）。
async function sweepUninvoicedPaidOrders(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  summary: Summary,
): Promise<boolean> {
  const { data: uninvoiced, error } = await serviceRole
    .from("orders")
    .select("id")
    .eq("status", "paid")
    .eq("invoice_status", "none")
    .order("created_at", { ascending: true })
    .limit(INVOICE_SWEEP_LIMIT);

  if (error) {
    Sentry.captureMessage("reconcile: 未開票訂單查詢失敗", {
      level: "error",
      extra: { error: error.message },
    });
    return false;
  }

  for (const order of uninvoiced ?? []) {
    summary.invoicesSwept += 1;
    const result = await issueInvoiceForOrder(serviceRole, order.id);
    if (result.ok) {
      summary.invoicesIssued += 1;
      // 走到 sweep 才開成＝webhook 那次失敗過，留告警追蹤（比照 promoted 慣例）
      Sentry.captureMessage("reconcile: 補開發票成功（webhook 當次曾失敗）", {
        level: "warning",
        extra: { orderId: order.id, invoiceNo: result.invoiceNo },
      });
    } else {
      summary.invoicesFailed += 1;
      Sentry.captureMessage("reconcile: 補開發票仍失敗，需人工處理", {
        level: "error",
        extra: { orderId: order.id, error: result.error },
      });
    }
    await sleep(THROTTLE_MS);
  }
  return true;
}

// T89：ECPay 主動對帳。webhook 是即時路徑，這支 cron 是每日一次的最終防線——
// 只做「pending→paid 的主動修正＋告警」，範圍刻意不含逾期取消（見 T66）。
export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const summary: Summary = {
    checked: 0,
    promoted: 0,
    driftChecked: 0,
    driftPromoted: 0,
    driftTruncated: false,
    promotedOnClosedOrder: 0,
    paidOnCancelled: 0,
    paidOnCancelledTruncated: false,
    paidOnRefunded: 0,
    paidOnRefundedTruncated: false,
    candidatesSaturated: false,
    mismatches: 0,
    failed: 0,
    unexpected: 0,
    notifyFailed: 0,
    sweepRetried: 0,
    sweepSent: 0,
    sweepStillFailing: 0,
    rateLimited: false,
    httpAborted: false,
    invoicesSwept: 0,
    invoicesIssued: 0,
    invoicesFailed: 0,
  };

  try {
    const serviceRole = createServiceRoleClient();
    const now = Date.now();
    const maxCreatedAt = new Date(now - MIN_AGE_MS).toISOString();
    const reconcileCutoff = new Date(now - RECONCILE_COOLDOWN_MS).toISOString();

    // 冷卻過濾字串走 nullOrBefore 單一出處（雙引號包 timestamp 的 PostgREST
    // 陷阱說明見該 helper 的註解）。
    const { data: candidates, error } = await serviceRole
      .from("payment")
      .select("id, order_id, merchant_trade_no, amount")
      .eq("status", "pending")
      .lt("created_at", maxCreatedAt)
      .or(nullOrBefore("last_reconciled_at", reconcileCutoff))
      .order("created_at", { ascending: true })
      .limit(CANDIDATE_LIMIT);

    if (error) throw new Error(`候選查詢失敗: ${error.message}`);

    // T102：撈滿 CANDIDATE_LIMIT＝pending 積壓逼近單輪容量。這是 webhook 大面積
    // 失靈的早期訊號（成因與修復在 webhook 端，非對帳），發 warning 當預警——
    // 不放大批量硬撐（見 CANDIDATE_LIMIT 註解）。恰好等於上限即告警（不多撈 +1
    // 偵測溢出）：這是「早期」訊號，寧可對「剛好滿載」也提早示警。
    if ((candidates?.length ?? 0) >= CANDIDATE_LIMIT) {
      summary.candidatesSaturated = true;
      Sentry.captureMessage("reconcile: candidate list saturated", {
        level: "warning",
        extra: { candidateLimit: CANDIDATE_LIMIT },
      });
    }

    // 本次排程只要有任一筆 queryTradeInfo 成功回應（證明金鑰正常），就把
    // 連續-403 計數歸零一次；flag 避免每筆成功都打一次 redis.del。
    let reconcile403Reset = false;

    for (const payment of candidates ?? []) {
      summary.checked += 1;

      let result;
      try {
        result = await queryTradeInfo(payment.merchant_trade_no);
      } catch (e) {
        if (e instanceof RateLimitError) {
          summary.rateLimited = true;
          if (e.status === 403) {
            // 403 可能是綠界限流（ops-runbook 實測），也可能是持續性的金鑰／
            // CheckMacValue 失效。連續計數：本次 +1，達門檻升級 error 點名
            // 「疑似憑證失效」，否則維持 warning，避免對偶發節流狂告警。
            let consecutive = 1;
            try {
              consecutive = await redis.incr(CONSECUTIVE_403_KEY);
            } catch {
              // Redis 掛：fail-open，當第一次處理（不升級、不讓對帳崩）。
            }
            const escalate = consecutive >= CONSECUTIVE_403_ERROR_THRESHOLD;
            Sentry.captureMessage(
              escalate
                ? "reconcile: 連續 403，疑似 ECPay 金鑰／CheckMacValue 失效（非限流），請查憑證"
                : "reconcile: rate limited (403), aborting batch",
              {
                level: escalate ? "error" : "warning",
                extra: {
                  merchantTradeNo: payment.merchant_trade_no,
                  status: 403,
                  consecutive,
                  error: e.message,
                },
              },
            );
          } else {
            // 429／503：明確的暫時性限流／服務不可用，維持 warning、不計數。
            Sentry.captureMessage("reconcile: rate limited, aborting batch", {
              level: "warning",
              extra: {
                merchantTradeNo: payment.merchant_trade_no,
                status: e.status,
                error: e.message,
              },
            });
          }
          break;
        }
        // T99：非限流的 HTTP 層失敗（ECPay 5xx 等）同樣中止整批（系統性
        // 故障，逐筆硬跑只會把候選蓋上冷卻戳記、延後自癒），但告警不再
        // 誤標「被限流」。這條路徑不寫 last_reconciled_at，下次排程原樣重試。
        if (e instanceof QueryTradeInfoHttpError) {
          summary.httpAborted = true;
          Sentry.captureMessage(
            "reconcile: QueryTradeInfo HTTP error, aborting batch",
            {
              level: "error",
              extra: {
                merchantTradeNo: payment.merchant_trade_no,
                status: e.status,
                error: e.message,
              },
            },
          );
          break;
        }
        // 單筆查詢失敗（含 CheckMacValue 驗證失敗）：記錄並繼續下一筆，
        // 不讓一筆髒資料拖垮整批；last_reconciled_at 仍要寫，避免明天重查同一筆卡死。
        recordUnexpected(summary, e, payment);
        await markReconciled(serviceRole, payment.id);
        // 節流不能因為這筆失敗就跳過——連續幾筆壞資料若零間隔連續打
        // ECPay，正是節流機制原本要防止的情況。
        await sleep(THROTTLE_MS);
        continue;
      }

      // 有成功回應＝金鑰正常，清掉連續-403 計數（每次排程至多一次）。
      if (!reconcile403Reset) {
        reconcile403Reset = true;
        try {
          await redis.del(CONSECUTIVE_403_KEY);
        } catch {
          // fail-open：清不掉頂多下次多留一格，不影響對帳主流程。
        }
      }

      // 不論後續分支結果如何，先記錄查過的時間，避免同一筆在冷卻期
      // （RECONCILE_COOLDOWN_MS）內被重複告警。
      await markReconciled(serviceRole, payment.id);

      if (result.tradeStatus === "1") {
        // 金額三檢（non-finite／non-positive／mismatch）走 validateSettleAmount
        // 單一出處（與 notify 兩分支共用，杜絕散落複本失同步），但保留 reconcile
        // 既有的計數/訊息分流：non-finite→unexpected＋「TradeAmt 格式異常」；
        // 非吻合（含 0===0 零元）→下方 mismatch 分支交人工。
        const amountCheck = validateSettleAmount(
          result.tradeAmt,
          payment.amount,
        );
        if (!amountCheck.ok && amountCheck.reason === "non-finite") {
          summary.unexpected += 1;
          Sentry.captureMessage("reconcile: TradeAmt 格式異常", {
            level: "error",
            extra: {
              merchantTradeNo: payment.merchant_trade_no,
              tradeAmt: result.raw.TradeAmt,
            },
          });
        } else if (amountCheck.ok) {
          // 單一 try/catch 包住 ①②③：①的 throw 自然跳過②③（候選鍵保留、
          // 冷卻期滿隔日自動重試＝F-014 修正核心）；②走 {error} 解構、不
          // throw；③的 throw 落到同一個 catch。任何單筆失敗都不可中止整批
          // （外層 catch 會直接 500，其餘候選當天全數不對帳）——記錄後繼續
          // 下一筆（T88 review）。
          try {
            // ① 先推進訂單、payment 翻 paid 留到最後（T107／F-014）：候選查詢
            // 以 payment.status='pending' 為鍵，若先翻 payment 再推進訂單，推進
            // 段失敗時候選鍵已被消滅，隔日 cron 永遠選不到這筆——客人已付款、
            // 訂單永久卡 pending_payment、確認信未寄，安全網自身留盲點。
            // ensureOrderPaid 冪等（CAS 走 transition_order_status RPC，狀態
            // 推進＋稽核 log 同一交易，T110），webhook 已推進時安全 no-op；
            // log 寫入失敗會 rollback 推進並 throw（落到本 catch，候選鍵保留
            // 隔日重試）。promoted 計數掛在①的回傳（見下方分類），計在搶救
            // 真正發生那一輪；隔日補翻 payment 的那一輪①回 already-settled、
            // 不再重複計。
            const orderResult = await ensureOrderPaid(
              serviceRole,
              payment.order_id,
              "reconcile",
            );

            // ② CAS 把 payment 翻 paid。.select().maybeSingle() 取得是否真的
            // 搶到這次 CAS：webhook 可能在 candidate 查詢之後、這個 UPDATE 之
            // 前就先推進成功，此時 0 rows affected 但 Supabase 不會回傳 error
            // ——若不檢查就會把「webhook 其實正常運作」誤報成「對帳搶救了卡住
            // 的訂單」，污染 T88 要追蹤的 webhook 可靠度訊號。
            const { data: promotedRow, error: updateError } = await serviceRole
              .from("payment")
              .update({
                status: "paid",
                gateway_trade_no: result.tradeNo,
                paid_at: new Date().toISOString(),
                raw_callback: result.raw,
              })
              .eq("id", payment.id)
              .eq("status", "pending") // CAS guard：防與 webhook 競態
              .select("id")
              .maybeSingle();

            if (updateError) {
              // 訂單已推進（①成功）、payment 留 pending：候選鍵保留，隔日
              // 重撈時①冪等 no-op、這裡的 CAS 重試補翻。短暫的「orders=paid
              // 但 payment=pending」漂移屬自癒中，勿人工介入（ops-runbook §1）
              // ——嚴重度比照「promoted stuck payment」用 warning，不進
              // exception。不擋③——訂單已 paid，信該寄。
              summary.unexpected += 1;
              Sentry.captureMessage("reconcile: payment CAS update failed", {
                level: "warning",
                extra: {
                  orderId: payment.order_id,
                  merchantTradeNo: payment.merchant_trade_no,
                  error: updateError.message,
                },
              });
            }

            // 分類掛在①的 orderResult 上、不論②結果——②只回答「payment 這
            // 一輪有沒有翻成」，回答不了「這筆搶救的性質」：分類若 gate 在
            // ② CAS 搶贏上，② CAS miss／{error} 時「錢收在已關閉訂單」的
            // P0 告警整個不發（漏報）、promoted 也計錯天。
            if (orderResult === "closed") {
              // ①重查已確認訂單處於 cancelled／refunded 等關閉狀態，但綠界
              // 確認錢已收到——payment 照翻 paid（財務事實：gateway_trade_no／
              // raw_callback 是日後退款的唯一依據，必須落地），但這不是
              // 「搶救成功」：不計 promoted、走獨立計數＋error 級告警，與
              // 健康搶救訊號分流。不論②結果都要發：② CAS miss＝payment 被
              // 別人翻的，錢一樣收在已關閉訂單上；② {error}＝payment 留
              // pending、隔日再入選再告警，對 P0 錢務問題是催辦不是噪音。
              // 單次告警漏看的殘餘風險由人工裁決程序承接（ops-runbook §6.1）；
              // 另有 recurring 稽核臂（auditPaidOnCancelledOrders）durable 兜底。
              recordClosedOrder(summary, payment);
            } else if (orderResult === "promoted") {
              // 對帳路徑真的修正了訂單＝webhook 那條路徑當初失敗過；即使結果
              // 正確，也留一筆告警，方便日後追蹤 webhook 可靠度（呼應 T88）。
              // 不論②結果：搶救＝①把訂單推進成 paid，計在發生的這一輪；
              // ②失敗只代表 payment 隔日補翻，屆時①回 already-settled 不重計。
              summary.promoted += 1;
              Sentry.captureMessage("reconcile: promoted stuck payment", {
                level: "warning",
                extra: {
                  orderId: payment.order_id,
                  merchantTradeNo: payment.merchant_trade_no,
                },
              });
            } else if (orderResult === "indeterminate" && promotedRow) {
              // ①無法確認訂單現況（重查失敗／查無此單，①內已發 P0 告警）：
              // 對計數維持保守語意——只有這一輪確實翻了 payment（② CAS 搶贏）
              // 才計 promoted，不憑「查不到」推論搶救性質。
              summary.promoted += 1;
              Sentry.captureMessage("reconcile: promoted stuck payment", {
                level: "warning",
                extra: {
                  orderId: payment.order_id,
                  merchantTradeNo: payment.merchant_trade_no,
                },
              });
            }
            // orderResult === "already-settled"：不計數——搶救（若曾發生）已
            // 計在它真正發生的那一輪；②搶贏只是 payment 補翻，不是新事件。

            // ③ 補寄通知。冪等，且不 gate payment 翻 paid：payment.status 是
            // 財務記錄（錢已確認收到），不拿它當通知重試旗標——通知失敗由
            // 下方 failed-notification sweep 每天補救，webhook 端的 ECPay
            // 重送（若還有回呼）也走 reclaim 補寄。②的 updateError／CAS 輸給
            // webhook 都不影響這裡照跑；訂單已關閉時它內部自行判斷不寄。
            const notified = await ensureNotificationSent(
              serviceRole,
              payment.order_id,
            );
            if (!notified) {
              // 已知取捨：併發雙跑（手動觸發撞上排程）時 sendOnce 的輸方會讓
              // 這個計數虛報——「false＝未確認送達」是 T88 契約，不為降噪改
              // 弱；實際投遞由 sendOnce 天然去重、sweep 自癒。
              recordNotifyFailed(summary, payment);
            }
          } catch (e) {
            recordUnexpected(summary, e, payment);
          }
        } else {
          // 金額不符：只告警，絕不自動改狀態——對帳的自動修正權限收斂到
          // 「明確吻合」才能動用，呼應「絕不信任前端價格」的紅線精神。
          // payment 留 pending＝每日重新入選、每日重告警：這是 P0 錢務問題
          // 的催辦機制（intentional），人工處理完（ops-runbook §2）告警自止。
          // 能走到這裡且兩值相等＝同為 0 被上方正數防呆擋下——那不是「金額
          // 不符」而是「零元 payment」異常（建單 bug／回應被解析成 0），
          // 訊息分開，告警才不會把人導去查根本不存在的差額。
          summary.mismatches += 1;
          Sentry.captureMessage(
            Number(result.tradeAmt) === Number(payment.amount)
              ? "reconcile: zero-amount payment anomaly"
              : "reconcile: amount mismatch",
            {
              level: "error",
              extra: {
                orderId: payment.order_id,
                merchantTradeNo: payment.merchant_trade_no,
                tradeAmt: result.tradeAmt,
                paymentAmount: payment.amount,
              },
            },
          );
        }
      } else if (result.tradeStatus === "10200095") {
        // ECPay 官方文件記載的付款失敗碼：只告警，不把 payment.status 改成
        // failed——讓客人能重新付款屬 T66/T74 待付款生命週期整批的範圍。
        // payment 留 pending＝每日重告警屬 intentional 催辦，同 mismatch 分支。
        summary.failed += 1;
        Sentry.captureMessage("reconcile: ECPay reports payment failed", {
          level: "warning",
          extra: {
            orderId: payment.order_id,
            merchantTradeNo: payment.merchant_trade_no,
          },
        });
      } else if (result.tradeStatus === "0") {
        // 真的還沒付款：不動作，留給未來 T66。
      } else {
        // 非上述任何已知值（含缺欄位）：非預期回應，只告警。
        summary.unexpected += 1;
        Sentry.captureMessage("reconcile: unexpected TradeStatus", {
          level: "warning",
          extra: {
            merchantTradeNo: payment.merchant_trade_no,
            raw: result.raw,
          },
        });
      }

      await sleep(THROTTLE_MS);
    }

    // T127②：漂移臂在主迴圈之後跑——不打 ECPay，主迴圈被 rate limit 中斷
    // （break）也照跑（理由同下方發票 sweep）。各子臂回 false＝其候選查詢
    // 失敗；任一失敗就讓整支 cron 回 HTTP 500，讓以 HTTP 狀態判健康的 cron
    // 監控看得到紅燈（而非把「子臂靜默沒跑」誤看成綠燈）。子臂之間彼此獨立，
    // 一個查詢失敗不阻斷其餘子臂照跑，故用旗標累積、最後一起判。
    // （T110 合流裁決：master 的 sweepDivergedPaidOrders 功能被本漂移臂完整
    // 涵蓋——截斷偵測、殘留 pending 清理、closed 分類皆本臂較完整——已刪除。）
    let degraded = false;

    degraded = !(await reconcileDriftedOrders(serviceRole, summary)) || degraded;

    // recurring 稽核臂：payment=paid ∧ orders=cancelled 的 durable 復發偵測。
    degraded =
      !(await auditPaidOnClosedOrders(serviceRole, summary, {
        orderStatus: "cancelled",
        countKey: "paidOnCancelled",
        truncatedKey: "paidOnCancelledTruncated",
        queryFailMessage: "reconcile: paid-on-cancelled 稽核查詢失敗",
        truncateMessage: "reconcile: paid-on-cancelled backlog exceeds limit",
        driftMessage: "reconcile: paid payment on cancelled order",
      })) || degraded;

    // recurring 稽核臂（T47）：payment=paid ∧ orders=refunded（Admin Override
    // 逃生口留下的半套狀態）的 durable 復發偵測。
    degraded =
      !(await auditPaidOnClosedOrders(serviceRole, summary, {
        orderStatus: "refunded",
        countKey: "paidOnRefunded",
        truncatedKey: "paidOnRefundedTruncated",
        queryFailMessage: "reconcile: paid-on-refunded 稽核查詢失敗",
        truncateMessage: "reconcile: paid-on-refunded backlog exceeds limit",
        driftMessage: "reconcile: paid payment on refunded order",
      })) || degraded;

    degraded = !(await sweepFailedNotifications(serviceRole, summary)) || degraded;

    // T42：付款對帳跑完後接著補開發票——即使上面被 rate limit 中斷也照跑
    // （發票 API 是獨立網域與額度，不受金流查詢限速影響）
    degraded =
      !(await sweepUninvoicedPaidOrders(serviceRole, summary)) || degraded;

    return Response.json(summary, { status: degraded ? 500 : 200 });
  } catch (e) {
    console.error("[ecpay-reconcile] unhandled error", e);
    Sentry.captureException(e);
    return Response.json(summary, { status: 500 });
  }
}
