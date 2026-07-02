import { notFound } from "next/navigation"
import { requireUser } from "@/lib/auth/require-user"
import { createClient } from "@/lib/supabase/server"
import { formatCurrency, formatDateTime } from "@/lib/utils"
import {
  STATUS_LABELS,
  STATUS_PILL_STYLES,
  type OrderStatus,
} from "@/lib/order/order-status"

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireUser()
  const { id } = await params
  const supabase = await createClient()

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .eq("member_id", user.id)
    .single()

  if (!order) notFound()

  const [{ data: items }, { data: logs }] = await Promise.all([
    supabase
      .from("order_item")
      .select(
        "id, product_id, product_name_snapshot, quantity, unit_price_snapshot, config_snapshot",
      )
      .eq("order_id", id)
      .order("created_at"),
    supabase
      .from("order_status_log")
      .select("from_status, to_status, created_at")
      .eq("order_id", id)
      .order("created_at"),
  ])

  const status = order.status as OrderStatus

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-heading text-2xl text-ink">{order.order_no}</h2>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] tracking-[0.08em] ${STATUS_PILL_STYLES[status]}`}
        >
          {STATUS_LABELS[status]}
        </span>
        <span className="text-sm text-ash">
          {formatDateTime(order.created_at)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-6">
          <h3 className="mb-4 text-[11px] tracking-[0.16em] text-ash uppercase">
            處理進度
          </h3>
          {logs && logs.length > 0 ? (
            <ol>
              {logs.map((log, i) => (
                <li
                  key={i}
                  className="relative border-l border-stone py-0 pb-5 pl-6 last:border-transparent last:pb-0"
                >
                  <span className="absolute top-1 -left-[4.5px] size-2 rounded-full bg-primary" />
                  <div className="text-sm text-ink">
                    {log.from_status ? (
                      <>
                        {STATUS_LABELS[log.from_status as OrderStatus]} →{" "}
                        {STATUS_LABELS[log.to_status as OrderStatus]}
                      </>
                    ) : (
                      STATUS_LABELS[log.to_status as OrderStatus]
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-ash">
                    {formatDateTime(log.created_at)}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ash">尚無狀態紀錄</p>
          )}

          <div className="mt-4 rounded-lg border border-border bg-cloud px-4 py-3 text-sm">
            物流單號：
            {order.tracking_no ? (
              <span className="ml-1 font-mono text-ink">
                {order.tracking_no}
              </span>
            ) : (
              <span className="ml-1 text-ash">尚未出貨</span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border p-6">
          <h3 className="mb-4 text-[11px] tracking-[0.16em] text-ash uppercase">
            品項
          </h3>
          <div className="space-y-4">
            {(items ?? []).map((item) => {
              const snapshot = item.config_snapshot as {
                selections?: { label: string }[]
              } | null
              const selectionsSummary = (snapshot?.selections ?? [])
                .map((s) => s.label)
                .join(" · ")
              return (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-4 text-sm"
                >
                  <div>
                    <div className="text-ink">
                      {item.product_name_snapshot ?? item.product_id}
                    </div>
                    {selectionsSummary && (
                      <div className="mt-0.5 text-xs text-ash">
                        {selectionsSummary}
                      </div>
                    )}
                    <div className="mt-0.5 text-xs text-ash">
                      {formatCurrency(Number(item.unit_price_snapshot))} ×{" "}
                      {item.quantity}
                    </div>
                  </div>
                  <div className="shrink-0 text-primary">
                    {formatCurrency(
                      Number(item.unit_price_snapshot) * item.quantity,
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-4 text-sm">
            <span>合計</span>
            <span className="text-primary">
              {formatCurrency(Number(order.total_amount))}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
