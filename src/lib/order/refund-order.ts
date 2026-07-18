import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  transitionOrder,
  OrderTransitionRaceError,
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

// T47 記錄式退款：實際刷退由管理者先在綠界廠商後台人工完成，本函式只負責
// 退刷「之後」的系統側一致性——payment 翻 refunded、orders 走狀態機轉
// refunded（含稽核 log）。整體冪等：任何一步之後中斷，重跑本函式即收斂。
//
// 順序刻意「先 payment、後 orders」，遵循 ops-runbook §8 的權威順序（人工
// 已在綠界退刷完成，payment 較接近金流事實，先讓它落地），不是遺漏
// transaction——兩步之間失敗（payment 已翻、orders 沒轉）時，重試會因存在
// 檢查的 in ('paid','refunded') 條件仍撈得到那筆 refunded payment 而繼續
// 走完 orders 轉換，不會卡死；反向順序反而會出現「訂單顯示已退款、payment
// 還掛 paid」的窗口，誤導對帳。
export async function refundOrder(
  orderId: string,
  options: { actorId: string; reason: string },
): Promise<void> {
  const supabase = createServiceRoleClient();

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

  // 條件式 UPDATE 翻掉這張單「全部」paid payment（不挑單筆：§5 重複付款
  // 情境下可能存在已人工退刷的 refunded 複本，挑「最新一筆」可能挑到複本
  // 而漏翻真正的 paid）。WHERE 帶 status='paid' 且 SET 改動該欄位，符合
  // §6 CAS 規則。0 rows 不是失敗：上面的存在檢查已確認 paid/refunded 至少
  // 一筆存在，走到這裡 0 rows 只可能是「重試時已翻過」或「並發請求剛翻走」
  // ——兩者都是冪等成功，繼續往下轉 orders 即可。
  const { error: updateError } = await supabase
    .from("payment")
    .update({ status: "refunded" })
    .eq("order_id", orderId)
    .eq("status", "paid");

  if (updateError) {
    throw new Error(`payment 標記 refunded 失敗：${updateError.message}`);
  }

  try {
    await transitionOrder(orderId, "refunded", {
      actorId: options.actorId,
      note: options.reason,
    });
  } catch (e) {
    // 只攔競態錯誤：orders 已被翻成 refunded（重試／並發）時 transitionOrder
    // 會因 refunded 無出口而丟 RaceError，複查現況確認後視為冪等成功。
    // 複查非 refunded（真的被別的流程搶去別的狀態）或其他任何錯誤（DB 故障、
    // log 寫入失敗 rollback 等）一律原樣上拋，不得吞掉。
    if (!(e instanceof OrderTransitionRaceError)) throw e;

    const { data: order, error: recheckError } = await supabase
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .maybeSingle();

    if (recheckError) {
      throw new Error(`退款後複查訂單狀態失敗：${recheckError.message}`);
    }
    if (order?.status !== "refunded") throw e;
  }
}
