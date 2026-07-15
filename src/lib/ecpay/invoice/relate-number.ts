import "server-only";

// RelateNumber（發票關聯編號）：≤50 字元、唯一、大小寫視為相同（官方 7896）。
// 由既有 merchant_trade_no（見 ../merchant-trade-no.ts，最長 19 碼英數字）
// 衍生，單一出處，保證「一筆付款最多一張發票」的冪等——ECPay 對重複
// RelateNumber 會拒絕（1200 系列），代表冪等生效而非故障。
export function buildInvoiceRelateNumber(merchantTradeNo: string): string {
  return `INV${merchantTradeNo}`;
}
