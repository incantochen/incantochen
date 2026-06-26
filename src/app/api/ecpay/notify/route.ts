import "server-only"
import { verifyCheckMacValue } from "@/lib/ecpay/check-mac-value"
import { serverEnv } from "@/lib/env.server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

const OK = () =>
  new Response("1|OK", { status: 200, headers: { "Content-Type": "text/plain" } })
const ERR = (msg: string) =>
  new Response(`0|${msg}`, { status: 200, headers: { "Content-Type": "text/plain" } })

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const params: Record<string, string> = {}
    for (const [k, v] of formData.entries()) params[k] = String(v)

    // CheckMacValue 驗章（安全關卡）
    if (!verifyCheckMacValue(params, serverEnv.ECPAY_HASH_KEY, serverEnv.ECPAY_HASH_IV)) {
      return ERR("CheckMacValue Error")
    }

    const merchantTradeNo = params.MerchantTradeNo
    if (!merchantTradeNo) return ERR("MerchantTradeNo missing")

    const serviceRole = createServiceRoleClient()

    // 查訂單（MerchantTradeNo = order_no 去 hyphen，格式 INC20260626XXXXXX）
    const orderNo = `${merchantTradeNo.slice(0, 3)}-${merchantTradeNo.slice(3, 11)}-${merchantTradeNo.slice(11)}`
    const { data: order } = await serviceRole
      .from("orders")
      .select("id, status")
      .eq("order_no", orderNo)
      .maybeSingle()

    if (!order) return ERR("Order not found")

    // 冪等：已 paid → 直接 1|OK
    const { data: existing } = await serviceRole
      .from("payment")
      .select("id, status")
      .eq("merchant_trade_no", merchantTradeNo)
      .maybeSingle()

    if (existing?.status === "paid") return OK()

    const isPaid = params.RtnCode === "1"
    const now = new Date().toISOString()

    if (existing) {
      await serviceRole
        .from("payment")
        .update({
          status: isPaid ? "paid" : "failed",
          gateway_trade_no: params.TradeNo ?? null,
          paid_at: isPaid ? now : null,
          raw_callback: params,
        })
        .eq("id", existing.id)
    } else {
      await serviceRole.from("payment").insert({
        order_id: order.id,
        merchant_trade_no: merchantTradeNo,
        gateway_trade_no: params.TradeNo ?? null,
        amount: parseInt(params.TradeAmt ?? "0", 10),
        provider: "ecpay",
        status: isPaid ? "paid" : "failed",
        paid_at: isPaid ? now : null,
        raw_callback: params,
      })
    }

    // 訂單狀態只從 pending_payment 往前推
    if (isPaid && order.status === "pending_payment") {
      await serviceRole.from("orders").update({ status: "paid" }).eq("id", order.id)
    }

    return OK()
  } catch {
    return OK()
  }
}
