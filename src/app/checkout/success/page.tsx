import { redirect } from "next/navigation"
import Link from "next/link"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { OrderStatusCheck } from "./order-status-check"

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>
}) {
  const { order: orderNo } = await searchParams

  if (!orderNo) redirect("/")

  const serviceRole = createServiceRoleClient()
  const { data: order } = await serviceRole
    .from("orders")
    .select("order_no, status, total_amount, recipient_name, member:member_id(email)")
    .eq("order_no", orderNo)
    .maybeSingle()

  if (!order) redirect("/")

  const memberData = order.member
  const email = Array.isArray(memberData) ? memberData[0]?.email : memberData?.email

  if (order.status === "paid") {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto">
            <svg
              className="h-8 w-8 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <p className="eyebrow mb-3">付款成功</p>
          <h1 className="font-head text-2xl text-ink mb-2">感謝您的訂購</h1>
          <p className="text-sm text-ash mb-8">
            我們將盡快為您精心製作，完成後會主動與您聯繫
          </p>

          <div className="mb-6 rounded-lg border border-border bg-cloud px-6 py-5 text-left space-y-4">
            <div>
              <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-0.5">
                訂單號碼
              </p>
              <p className="font-mono text-base font-medium text-ink">
                {order.order_no}
              </p>
            </div>
            <div>
              <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-0.5">
                付款金額
              </p>
              <p className="text-base font-medium text-ink">
                NT${order.total_amount.toLocaleString()}
              </p>
            </div>
            {email && (
              <div>
                <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-0.5">
                  確認信寄送至
                </p>
                <p className="text-base text-ink">{email}</p>
              </div>
            )}
          </div>

          {email && (
            <p className="text-xs text-ash mb-6">
              日後可用此 Email 登入查看訂單狀態
            </p>
          )}

          <Link
            href="/"
            className="inline-block rounded-[2px] border border-primary px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            返回首頁
          </Link>
        </div>
      </main>
    )
  }

  if (order.status === "pending_payment") {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 mx-auto">
            <svg
              className="h-8 w-8 text-amber-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>

          <h1 className="font-head text-2xl text-ink mb-2">確認付款中</h1>
          <p className="text-sm text-ash mb-6">
            系統正在確認您的付款，請稍候…
          </p>

          <div className="mb-6 rounded-lg border border-border bg-cloud px-6 py-4">
            <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-0.5">
              訂單號碼
            </p>
            <p className="font-mono text-base font-medium text-ink">
              {order.order_no}
            </p>
          </div>

          <OrderStatusCheck />

          <Link
            href="/"
            className="inline-block rounded-[2px] border border-border px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-ash uppercase hover:border-primary hover:text-primary transition-colors"
          >
            返回首頁
          </Link>
        </div>
      </main>
    )
  }

  redirect("/")
}
