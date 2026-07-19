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

// order_no 去 hyphen 的本體長度：INC(3) + YYYYMMDD(8) + XXXXXX(6) = 17。
const ORDER_NO_BASE_LEN = 17

/**
 * MerchantTradeNo（本體 17 碼 + 2 碼隨機後綴）反解回 order_no（INC-YYYYMMDD-XXXXXX）。
 * 識別碼格式互轉的「單一出處」——generateMerchantTradeNo 的逆運算，禁止呼叫端
 * 各自手刻 slice 重組（T67 的 slice(11) bug 即散落複本失同步所致；CLAUDE.md §6）。
 * 防呆：本體長度不足 17（格式異常／截斷）回 null，呼叫端據此走查無/降級分支，
 * 不硬塞出殘缺 order_no。
 */
export function merchantTradeNoToOrderNo(merchantTradeNo: string): string | null {
  const base = merchantTradeNo.slice(0, ORDER_NO_BASE_LEN)
  if (base.length < ORDER_NO_BASE_LEN) return null
  return `${base.slice(0, 3)}-${base.slice(3, 11)}-${base.slice(11, 17)}`
}
