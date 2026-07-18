import "server-only";
import * as Sentry from "@sentry/nextjs";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  canTransition,
  fetchCurrentStatus,
  transitionOrder,
  OrderTransitionRaceError,
  type OrderStatus,
} from "@/lib/order/state-machine";

// 「這筆訂單沒有任何可退款的收款記錄」——refundOrder 的存在檢查同時放行
// paid（首次退款）與 refunded（重試／並發已翻走的冪等重入），兩者都查無
// 才代表這張單從未收款成立、無從退起。呼叫端（admin action）據此 instanceof
// 分流成人話錯誤訊息，比照 PaidOrderCancelBlockedError 慣例。
export class NoRefundablePaymentError extends Error {
  constructor(orderId: string) {
    super(`訂單無可退款的收款記錄：${orderId}`);
    this.name = "NoRefundablePaymentError";
  }
}

// 「訂單目前狀態不可退款」——pre-guard 在動 payment 之前擋下。少了這道，
// 對 pending_payment（webhook 卡單，ops-runbook §1.1 第④類）或 cancelled
//（§6.1 錢收在已取消單上）的訂單登記退款會先把 payment 翻成 refunded、
// 訂單卻永遠轉不過去：重試不收斂，且以 payment='paid' 為鍵的對帳漂移臂／
// 稽核臂全被滅信號——錢的問題從此隱形。這類單的退款屬人工裁決（§6.1），
// 不走本流程。
export class OrderNotRefundableError extends Error {
  readonly currentStatus: OrderStatus;
  constructor(orderId: string, currentStatus: OrderStatus) {
    super(`訂單目前狀態（${currentStatus}）不可退款：${orderId}`);
    this.name = "OrderNotRefundableError";
    this.currentStatus = currentStatus;
  }
}

// T47 記錄式退款：實際刷退由管理者先在綠界廠商後台人工完成，本函式只負責
// 退刷「之後」的系統側一致性——payment 翻 refunded、orders 走狀態機轉
// refunded（含稽核 log）。整體冪等：任何一步之後中斷，重跑本函式即收斂
//（訂單已 refunded 的重入只補翻 payment、跳過狀態轉換）。
//
// 寫入順序刻意「先 payment、後 orders」，遵循 ops-runbook §8 的權威順序
//（人工已在綠界退刷完成，payment 較接近金流事實，先讓它落地），不是遺漏
// transaction——兩步之間失敗（payment 已翻、orders 沒轉）時，重試會因存在
// 檢查的 in ('paid','refunded') 條件仍撈得到那筆 refunded payment 而繼續
// 走完 orders 轉換，不會卡死；反向順序反而會出現「訂單顯示已退款、payment
// 還掛 paid」的窗口，誤導對帳。
export async function refundOrder(
  orderId: string,
  options: { actorId: string; reason: string },
): Promise<void> {
  const supabase = createServiceRoleClient();

  // Pre-guard：動 payment 之前先確認訂單現況可轉 refunded（或已是 refunded
  // 的冪等重入）。順序上這只是讀取，不違反「先 payment 後 orders」的寫入
  // 順序。查詢失敗／查無此單由 fetchCurrentStatus throw（T110 錯誤語意）。
  const statusBefore = await fetchCurrentStatus(supabase, orderId);
  if (statusBefore !== "refunded" && !canTransition(statusBefore, "refunded")) {
    throw new OrderNotRefundableError(orderId, statusBefore);
  }

  // 存在檢查：查 paid（首次）或 refunded（重試）。查詢失敗 ≠ 查無資料，
  // error 必 throw（CLAUDE.md §6），否則 DB 暫時性故障會被誤判成「沒收過款」。
  const { data: payment, error: queryError } = await supabase
    .from("payment")
    .select("id")
    .eq("order_id", orderId)
    .in("status", ["paid", "refunded"])
    .limit(1)
    .maybeSingle();

  if (queryError) {
    throw new Error(`退款前查詢 payment 失敗：${queryError.message}`);
  }
  if (!payment) {
    throw new NoRefundablePaymentError(orderId);
  }

  // 條件式 UPDATE 翻掉這張單的 paid payment（uq_payment_one_paid_per_order
  // 保證至多一筆；不挑 id 而以 order_id＋status 定位：§5 重複付款情境下可能
  // 存在已人工退刷的 refunded 複本，挑「最新一筆」可能挑到複本而漏翻真正的
  // paid）。WHERE 帶 status='paid' 且 SET 改動該欄位，符合 §6 CAS 規則。
  // 0 rows 不是失敗：上面的存在檢查已確認 paid/refunded 至少一筆存在，走到
  // 這裡 0 rows 只可能是「重試時已翻過」或「並發請求剛翻走」——兩者都是
  // 冪等成功，繼續往下轉 orders 即可。
  const { error: updateError } = await supabase
    .from("payment")
    .update({ status: "refunded" })
    .eq("order_id", orderId)
    .eq("status", "paid");

  if (updateError) {
    throw new Error(`payment 標記 refunded 失敗：${updateError.message}`);
  }

  // 冪等重入：訂單已是 refunded（先前執行在兩步之間中斷、或 Admin Override
  // 已改狀態但 payment 未翻的補登記）→ payment 已在上面補翻，狀態轉換沒有
  // 事可做。
  if (statusBefore === "refunded") return;

  try {
    await transitionOrder(orderId, "refunded", {
      actorId: options.actorId,
      note: options.reason,
    });
  } catch (e) {
    // 只攔競態錯誤：pre-guard 之後、transitionOrder 之前的窄窗內訂單被別的
    // 流程動過會走到這裡。複查現況＝refunded（並發退款重入）→ 冪等成功。
    // 其他任何錯誤（DB 故障、log 寫入失敗 rollback 等）一律原樣上拋，不得吞。
    if (!(e instanceof OrderTransitionRaceError)) throw e;

    const statusAfter = await fetchCurrentStatus(supabase, orderId);
    if (statusAfter !== "refunded") {
      // 殘餘 TOCTOU：payment 已翻 refunded、訂單卻被搶成其他狀態（如另一位
      // 管理者同刻 Override）。比照取消守衛的 post-check 慣例——偵測即告警
      //（人工裁決走 ops-runbook §6.1），錯誤照拋讓操作者知道沒完成。
      Sentry.captureMessage(
        "refundOrder: payment flipped to refunded but order transition lost race",
        {
          level: "error",
          extra: { orderId, statusAfter },
        },
      );
      throw e;
    }
  }
}
