import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  canTransition,
  fetchCurrentStatus,
  OrderTransitionRaceError,
  type OrderStatus,
} from "@/lib/order/state-machine";
import { findRefundablePayment } from "@/lib/order/find-paid-payment";

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

// 「訂單目前狀態不可退款」——動 payment 之前擋下。少了這道，對 pending_payment
//（webhook 卡單，ops-runbook §1.1 第④類）或 cancelled（§6.1 錢收在已取消單上）
// 的訂單登記退款屬人工裁決（§6.1），不走本流程。
export class OrderNotRefundableError extends Error {
  readonly currentStatus: OrderStatus;
  constructor(orderId: string, currentStatus: OrderStatus) {
    super(`訂單目前狀態（${currentStatus}）不可退款：${orderId}`);
    this.name = "OrderNotRefundableError";
    this.currentStatus = currentStatus;
  }
}

// Admin Override 逃生口（paid→refunded）不翻 payment、不寄信，留下
// 「order=refunded ∧ payment=paid」的半套狀態（refund-section.tsx 的
// needsPaymentRepair）。此路徑補翻殘留的 paid payment 並把 reason 落進
// order_status_log——原子 RPC 不適用（訂單狀態不變、無轉換可做）。
async function repairRefundedOrderPayment(
  supabase: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
  options: { actorId: string; reason: string },
): Promise<void> {
  // 條件式 UPDATE（帶 status='paid' 且 SET 改動該欄位，§6 CAS 規則）：並發雙擊
  // 只有一筆搶到 paid，回傳被翻的列供判斷是否真的補翻了。
  const { data: flipped, error: updateError } = await supabase
    .from("payment")
    .update({ status: "refunded" })
    .eq("order_id", orderId)
    .eq("status", "paid")
    .select("id");

  if (updateError) {
    throw new Error(`payment 補翻 refunded 失敗：${updateError.message}`);
  }

  // 只在確實補翻了 payment 時寫稽核註記——避免重複點擊／payment 早已一致時灌
  // 無意義的 log。from=to=refunded 的同狀態列刻意作為「退款補登記」的稽核痕跡
  //（order_status_log 只 insert 不 update，同狀態註記可接受）。補上 code review
  // 指出的缺口：UI 承諾 reason「入內部稽核記錄」，冪等重入路徑原本卻靜默丟棄。
  if (flipped && flipped.length > 0) {
    const { error: logError } = await supabase.from("order_status_log").insert({
      order_id: orderId,
      from_status: "refunded",
      to_status: "refunded",
      note: `退款補登記（payment 同步）：${options.reason}`,
      actor_id: options.actorId,
      is_override: true,
    });
    if (logError) {
      throw new Error(`退款補登記稽核 log 失敗：${logError.message}`);
    }
  }
}

// T47 記錄式退款：實際刷退由管理者先在綠界廠商後台人工完成，本函式負責退刷
// 「之後」的系統側一致性。一般路徑走 refund_order RPC（migration 0020）——翻
// paid payment ＋ CAS 轉訂單 refunded ＋ 寫稽核 log 於單一交易內原子完成，CAS
// 未命中整筆 rollback（含 payment 翻面），徹底消滅「payment=refunded、
// order≠refunded」的半套狀態。訂單已 refunded 的重入（Admin Override 逃生口）
// 走 repair 路徑只補翻 payment。整體冪等：任一步後中斷，重跑即收斂。
export async function refundOrder(
  orderId: string,
  options: { actorId: string; reason: string },
): Promise<void> {
  const supabase = createServiceRoleClient();

  // 讀現況：查詢失敗／查無此單由 fetchCurrentStatus throw（T110 錯誤語意）。
  const statusBefore = await fetchCurrentStatus(supabase, orderId);
  if (statusBefore !== "refunded" && !canTransition(statusBefore, "refunded")) {
    throw new OrderNotRefundableError(orderId, statusBefore);
  }

  // 存在檢查（單一出處 findRefundablePayment）：查 paid（首次）或 refunded
  //（重入）。查詢失敗 ≠ 查無資料，error 必 throw（helper 內處理）；查無代表
  // 這張單從未收款成立。
  const refundable = await findRefundablePayment(supabase, orderId);
  if (!refundable) {
    throw new NoRefundablePaymentError(orderId);
  }

  // 重入／補登記：訂單已 refunded（Admin Override 逃生口留下、或前次已完成）
  // → 無狀態轉換可做，只補翻殘留 payment 並落 reason。
  if (statusBefore === "refunded") {
    await repairRefundedOrderPayment(supabase, orderId, options);
    return;
  }

  // 一般路徑：原子退款 RPC。CAS 未命中時 RPC raise U0002（整筆已 rollback、
  // payment 未翻）→ 競態；U0001（p_from=refunded）已由上面的重入分流排除。
  const { data, error } = await supabase
    .rpc("refund_order", {
      p_order_id: orderId,
      p_from: statusBefore,
      p_note: options.reason,
      p_actor_id: options.actorId,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "U0002") {
      throw new OrderTransitionRaceError(
        `退款狀態轉換競態（CAS 未命中）：${orderId}`,
      );
    }
    throw new Error(`退款交易失敗：${error.message}`);
  }
  if (!data) {
    // RPC 成功必回一列（CAS 未命中會走 error 分支）；走到這裡屬非預期，
    // 保守當競態處理，讓呼叫端回「請重新整理」而非誤報成功。
    throw new OrderTransitionRaceError(`退款未回傳結果：${orderId}`);
  }
}
