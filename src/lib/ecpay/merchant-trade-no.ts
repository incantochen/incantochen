import "server-only"

// ECPay MerchantTradeNo: 最多 20 碼英數字
// 格式：order_no 去 hyphen（17 碼）+ 2 隨機字元 = 19 碼
// 每次付款嘗試都產生新的，避免 ECPay 拒絕重複 trade no
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function generateMerchantTradeNo(orderNo: string): string {
  const base = orderNo.replace(/-/g, "")
  let suffix = ""
  for (let i = 0; i < 2; i++) {
    suffix += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return base + suffix
}
