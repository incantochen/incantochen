import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import {
  STATUS_LABELS,
  STATUS_PILL_STYLES,
  type OrderStatus,
} from "@/lib/order/order-status";
import {
  DELIVERY_METHOD_LABELS,
  type DeliveryMethod,
} from "@/lib/order/delivery-method";
import { parseTracking } from "@/lib/order/shipping-tracking";
import {
  REQUEST_TYPE_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_PILL_STYLES,
  canRequestSupport,
  type SupportRequestStatus,
  type SupportRequestType,
} from "@/lib/support/support-request";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  // maybeSingle（非 single）：0 筆回 {data:null,error:null}，error 只在真正
  // 的 DB 故障時才非 null——才能把「查無此訂單」（notFound）與「查詢失敗」
  // （throw→account/error.tsx 顯示系統忙碌）分開（§6）。
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .eq("member_id", user.id)
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) notFound();

  const [
    { data: items, error: itemsError },
    { data: logs, error: logsError },
    { data: supportRequests, error: supportError },
  ] = await Promise.all([
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
    supabase
      .from("support_request")
      .select("id, request_type, status, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
  ]);

  // §6：任一子查詢 DB 故障都 throw——不可靜默把訂單渲染成沒有品項／無狀態
  // 紀錄的殘缺畫面。
  if (itemsError || logsError || supportError) {
    throw itemsError ?? logsError ?? supportError;
  }

  const status = order.status as OrderStatus;
  const deliveryMethod = order.delivery_method as DeliveryMethod;
  const isPickup = deliveryMethod === "pickup";
  // 面交單的 tracking_no 是「面交 [備註]」——取備註文字（可能為空）；宅配則
  // tracking_no 即物流單號本身。修既有把「面交」raw 字串當物流單號顯示的瑕疵。
  const pickupNote = order.tracking_no
    ? parseTracking(order.tracking_no).pickupNote
    : "";
  const eligibleForSupport = canRequestSupport(status);
  const latestSupportRequest = (supportRequests ?? [])[0];

  // 補登記退款（0021 repair_refunded_payment）會寫一筆 from=to=refunded 的同狀態
  // 稽核自環（後台靠 note 的 [退款補登記] 前綴＋Override 標籤辨識）。客端時間軸
  // 不顯示 note，這筆對客人是無意義的「已退款 → 已退款」——濾掉同狀態列，只給
  // 客人看真正的狀態推進。
  const customerLogs = (logs ?? []).filter(
    (l) => l.from_status !== l.to_status,
  );

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
          {customerLogs.length > 0 ? (
            <ol>
              {customerLogs.map((log, i) => (
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

          <div className="mt-4 space-y-2">
            <div className="rounded-lg border border-border bg-cloud px-4 py-3 text-sm">
              配送方式：
              <span className="ml-1 text-ink">
                {DELIVERY_METHOD_LABELS[deliveryMethod]}
              </span>
            </div>
            <div className="rounded-lg border border-border bg-cloud px-4 py-3 text-sm">
              {isPickup ? (
                <>
                  面交狀態：
                  {order.tracking_no ? (
                    <span className="ml-1 text-ink">
                      面交自取{pickupNote ? `（${pickupNote}）` : ""}
                    </span>
                  ) : (
                    <span className="ml-1 text-ash">
                      備貨中，將由專人聯繫安排
                    </span>
                  )}
                </>
              ) : (
                <>
                  物流單號：
                  {order.tracking_no ? (
                    <span className="ml-1 font-mono text-ink">
                      {order.tracking_no}
                    </span>
                  ) : (
                    <span className="ml-1 text-ash">尚未出貨</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border p-6">
          <h3 className="mb-4 text-[11px] tracking-[0.16em] text-ash uppercase">
            品項
          </h3>
          <div className="space-y-4">
            {(items ?? []).map((item) => {
              const snapshot = item.config_snapshot as {
                selections?: { label: string }[];
              } | null;
              const selectionsSummary = (snapshot?.selections ?? [])
                .map((s) => s.label)
                .join(" · ");
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
              );
            })}
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-4 text-sm">
            <span>合計</span>
            <span className="text-primary">
              {formatCurrency(Number(order.total_amount))}
            </span>
          </div>

          {eligibleForSupport && (
            <div className="mt-6 border-t border-border pt-6">
              {latestSupportRequest && (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-cloud px-4 py-3 text-sm">
                  <div>
                    <div className="text-ink">
                      {
                        REQUEST_TYPE_LABELS[
                          latestSupportRequest.request_type as SupportRequestType
                        ]
                      }
                    </div>
                    <div className="mt-0.5 text-xs text-ash">
                      {formatDateTime(latestSupportRequest.created_at)}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] tracking-[0.08em] ${SUPPORT_STATUS_PILL_STYLES[latestSupportRequest.status as SupportRequestStatus]}`}
                  >
                    {
                      SUPPORT_STATUS_LABELS[
                        latestSupportRequest.status as SupportRequestStatus
                      ]
                    }
                  </span>
                </div>
              )}
              <Link
                href={`/account/orders/${order.id}/support`}
                className="inline-flex items-center justify-center rounded-btn border border-primary px-5 py-2.5 text-[11px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground"
              >
                商品問題回報
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
