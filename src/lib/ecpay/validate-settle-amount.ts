// ECPay 付款金額核對的單一出處：驗章通過後、標記 paid 前的金額防線。
// 原本 notify route 兩分支各貼一份、reconcile 又另一個形狀（T127③ 已記錄的
// 散落複本），收斂成純函式供三處共用；各呼叫端保留自己的回應行為
//（notify 回 0|Amount mismatch、reconcile 累加計數＋告警）。
//
// 三道檢查缺一不可：
// - non-finite：TradeAmt 為空字串／非數字時 parseInt→NaN，任何比對皆不相等，
//   須明確擋下（否則落到「金額不符」誤導查帳）。
// - non-positive：0===0 不得視為吻合——TradeAmt 與訂單金額同為 0（建單 bug／
//   異常回應被解析成 0）時絕不可據此標記 paid。
// - mismatch：金額不符。
// numeric 欄位（PostgREST 可能序列化成字串）一律 Number() 轉型後比對。
export type SettleAmountResult =
  | { ok: true }
  | { ok: false; reason: "non-finite" | "non-positive" | "mismatch" };

export function validateSettleAmount(
  tradeAmt: number,
  expectedAmount: number | string,
): SettleAmountResult {
  if (!Number.isFinite(tradeAmt)) return { ok: false, reason: "non-finite" };
  if (Number(tradeAmt) <= 0) return { ok: false, reason: "non-positive" };
  if (Number(tradeAmt) !== Number(expectedAmount)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
