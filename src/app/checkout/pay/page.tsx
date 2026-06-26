import { redirect } from "next/navigation"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { buildAioParams } from "@/lib/ecpay/aio-payment"
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
    .eq("status", "pending_payment")
    .maybeSingle()

  if (!order) {
    redirect("/checkout")
  }

  const { data: orderItems } = await serviceRole
    .from("order_item")
    .select("quantity, product:product_id ( name )")
    .eq("order_id", order.id)

  if (!orderItems || orderItems.length === 0) {
    redirect("/checkout")
  }

  const items = orderItems.map((item) => ({
    quantity: item.quantity,
    productName: item.product.name,
  }))

  const params = buildAioParams(order, items, serverEnv.NEXT_PUBLIC_SITE_URL)

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="font-head text-2xl text-ink mb-2">正在轉導至付款頁</h1>
        <p className="text-sm text-ash mb-8">請稍候，系統正在為您導向 ECPay 付款頁面...</p>

        <form id="ecpay-form" action={serverEnv.ECPAY_PAYMENT_URL} method="POST">
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
