import "server-only"
import { generateCheckMacValue } from "@/lib/ecpay/check-mac-value"
import { serverEnv } from "@/lib/env.server"
import type { Database } from "@/types/database.types"

type OrderRow = Database["public"]["Tables"]["orders"]["Row"]

type OrderItemForPayment = {
  quantity: number
  productName: string
}

function formatTaiwanTradeDate(date: Date): string {
  const parts = date.toLocaleString("sv-SE", { timeZone: "Asia/Taipei" })
  // sv-SE gives "yyyy-MM-dd HH:mm:ss" — ECPay wants "yyyy/MM/dd HH:mm:ss"
  return parts.replace(/-/g, "/")
}

function buildItemName(items: OrderItemForPayment[]): string {
  const joined = items
    .map((item) => `${item.productName} x${item.quantity}`)
    .join("#")
  return joined.length > 200 ? joined.slice(0, 200) : joined
}

export function buildAioParams(
  order: OrderRow,
  items: OrderItemForPayment[],
  siteUrl: string,
): Record<string, string> {
  const params: Record<string, string> = {
    MerchantID: serverEnv.ECPAY_MERCHANT_ID,
    MerchantTradeNo: order.order_no.replace(/-/g, ""),
    MerchantTradeDate: formatTaiwanTradeDate(new Date()),
    PaymentType: "aio",
    TotalAmount: String(order.total_amount),
    TradeDesc: "incantochen",
    ItemName: buildItemName(items),
    ReturnURL: `${siteUrl}/api/ecpay/notify`,
    OrderResultURL: `${siteUrl}/api/ecpay/order-result`,
    ChoosePayment: "Credit",
    EncryptType: "1",
  }

  params.CheckMacValue = generateCheckMacValue(
    params,
    serverEnv.ECPAY_HASH_KEY,
    serverEnv.ECPAY_HASH_IV,
  )

  return params
}
