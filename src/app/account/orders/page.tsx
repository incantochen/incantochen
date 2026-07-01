import Link from "next/link"
import { requireUser } from "@/lib/auth/require-user"
import { createClient } from "@/lib/supabase/server"
import { formatCurrency, formatDateTime } from "@/lib/utils"
import { STATUS_LABELS, STATUS_PILL_STYLES, type OrderStatus } from "@/lib/order/order-status"

export default async function OrdersPage() {
  const user = await requireUser()
  const supabase = await createClient()

  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, status, total_amount, created_at")
    .eq("member_id", user.id)
    .order("created_at", { ascending: false })

  if (!orders || orders.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-cloud px-6 py-10 text-center text-ash">
        目前沒有訂單，
        <Link href="/collections/ring" className="text-primary underline underline-offset-2">
          去逛逛戒指系列
        </Link>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-[1.2fr_1fr_1fr_auto] gap-3 bg-cloud px-5 py-3 text-[11px] tracking-[0.12em] text-ash uppercase">
        <span>訂單</span>
        <span>日期</span>
        <span>金額</span>
        <span>狀態</span>
      </div>
      {orders.map((order) => (
        <Link
          key={order.id}
          href={`/account/orders/${order.id}`}
          className="grid grid-cols-[1.2fr_1fr_1fr_auto] items-center gap-3 border-t border-border px-5 py-4 text-sm hover:bg-cloud"
        >
          <span className="text-primary underline underline-offset-2">{order.order_no}</span>
          <span className="text-ash">{formatDateTime(order.created_at)}</span>
          <span>{formatCurrency(Number(order.total_amount))}</span>
          <span
            className={`justify-self-start rounded-full px-2.5 py-1 text-[11px] tracking-[0.08em] ${STATUS_PILL_STYLES[order.status as OrderStatus]}`}
          >
            {STATUS_LABELS[order.status as OrderStatus]}
          </span>
        </Link>
      ))}
    </div>
  )
}
