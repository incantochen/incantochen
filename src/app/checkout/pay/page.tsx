import { redirect } from "next/navigation"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { buildAioParams } from "@/lib/ecpay/aio-payment"
import { generateMerchantTradeNo } from "@/lib/ecpay/merchant-trade-no"
import { serverEnv } from "@/lib/env.server"
import { EcpayAutoSubmit } from "@/components/ecpay-auto-submit"

export default async function CheckoutPayPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>
}) {
  const { order: orderNo } = await searchParams

  if (!orderNo) {
    redirect("/checkout")
  }

  const serviceRole = createServiceRoleClient()

  const { data: order } = await serviceRole
    .from("orders")
    .select("*")
    .eq("order_no", orderNo)
    .maybeSingle()

  if (!order) {
    redirect("/checkout")
  }

  // 已付款 → 直接進成功頁（避免重送 ECPay）
  if (order.status === "paid") {
    redirect(`/checkout/success?order=${orderNo}`)
  }

  if (order.status !== "pending_payment") {
    redirect("/")
  }

  const { data: orderItems } = await serviceRole
    .from("order_item")
    .select("quantity, product_name_snapshot, product:product_id ( name )")
    .eq("order_id", order.id)

  if (!orderItems || orderItems.length === 0) {
    redirect("/checkout")
  }

  // 冪等：復用現有 pending payment（頁面重整不重建），
  // 付款失敗後 status 變 failed，下次進來才產生新 trade no
  const { data: existingPending } = await serviceRole
    .from("payment")
    .select("merchant_trade_no")
    .eq("order_id", order.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let merchantTradeNo: string

  if (existingPending) {
    merchantTradeNo = existingPending.merchant_trade_no
  } else {
    merchantTradeNo = generateMerchantTradeNo(order.order_no)
    const { error } = await serviceRole.from("payment").insert({
      order_id: order.id,
      merchant_trade_no: merchantTradeNo,
      amount: order.total_amount,
      provider: "ecpay",
      status: "pending",
    })
    if (error) {
      redirect("/checkout")
    }
  }

  const items = orderItems.map((item) => ({
    quantity: item.quantity,
    // 快照優先（下單當下名稱）；join 現值僅供 null 窗口 fallback
    productName: item.product_name_snapshot ?? item.product.name,
  }))

  const params = buildAioParams(
    order,
    items,
    merchantTradeNo,
    serverEnv.NEXT_PUBLIC_SITE_URL,
  )

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="font-head text-2xl text-ink mb-2">正在轉導至付款頁</h1>
        <p className="text-sm text-ash mb-8">
          請稍候，系統正在為您導向 ECPay 付款頁面...
        </p>

        <form
          id="ecpay-form"
          action={serverEnv.ECPAY_PAYMENT_URL}
          method="POST"
        >
          {Object.entries(params).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <button
            type="submit"
            className="inline-block rounded-[2px] border border-primary px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            若未自動轉導，請點此繼續
          </button>
        </form>

        <EcpayAutoSubmit formId="ecpay-form" />
      </div>
    </main>
  )
}
