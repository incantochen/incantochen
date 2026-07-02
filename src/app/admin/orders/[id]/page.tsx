import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { STATUS_LABELS, type OrderStatus } from "@/lib/order/order-status";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { maskAddress, maskEmail, maskName, maskPhone } from "@/lib/pii/mask";
import { OrderActions } from "./order-actions";
import { CustomerInfo } from "./customer-info";

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending_payment: "bg-amber-100 text-amber-800",
  paid: "bg-blue-100 text-blue-800",
  in_production: "bg-purple-100 text-purple-800",
  shipped: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-700",
  refunded: "bg-red-100 text-red-800",
};

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = createServiceRoleClient();

  const [orderRes, itemsRes, paymentRes, logsRes] = await Promise.all([
    supabase
      .from("orders")
      .select(`*, member(id, email, name)`)
      .eq("id", id)
      .single(),

    supabase
      .from("order_item")
      .select(`*, product(name)`)
      .eq("order_id", id)
      .order("created_at"),

    supabase
      .from("payment")
      .select("status, merchant_trade_no, gateway_trade_no, paid_at, amount")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("order_status_log")
      .select(`*, actor:member(email)`)
      .eq("order_id", id)
      .order("created_at"),
  ]);

  if (orderRes.error || !orderRes.data) notFound();

  const order = orderRes.data;
  const items = itemsRes.data ?? [];
  const payment = paymentRes.data;
  const logs = logsRes.data ?? [];
  const member = order.member as {
    id: string;
    email: string;
    name: string | null;
  } | null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* 頁頭 */}
        <div className="flex items-center gap-3">
          <Link
            href="/admin/orders"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← 訂單列表
          </Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl font-semibold text-gray-900 font-mono">
            {order.order_no}
          </h1>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status as OrderStatus]}`}
          >
            {STATUS_LABELS[order.status as OrderStatus]}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左欄：詳情 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 訂單資訊 */}
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-600 mb-4 uppercase tracking-wide">
                訂單資訊
              </h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-gray-500">訂單號</dt>
                  <dd className="font-mono">{order.order_no}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">建立時間</dt>
                  <dd>{formatDateTime(order.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">小計</dt>
                  <dd>{formatCurrency(Number(order.subtotal))}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">運費</dt>
                  <dd>{formatCurrency(Number(order.shipping_fee))}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">總金額</dt>
                  <dd className="font-semibold">
                    {formatCurrency(Number(order.total_amount))}
                  </dd>
                </div>
                {order.tracking_no && (
                  <div>
                    <dt className="text-gray-500">物流單號</dt>
                    <dd className="font-mono">{order.tracking_no}</dd>
                  </div>
                )}
              </dl>
            </section>

            {/* 客人資訊（T64：預設遮罩，揭示完整個資走 server action 並記稽核 log） */}
            <CustomerInfo
              orderId={order.id}
              maskedName={maskName(order.recipient_name)}
              maskedPhone={maskPhone(order.recipient_phone)}
              maskedEmail={maskEmail(member?.email)}
              maskedAddress={maskAddress(order.shipping_address)}
              zipCode={order.zip_code}
            />

            {/* 品項 */}
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-600 mb-4 uppercase tracking-wide">
                品項清單
              </h2>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="pb-2 text-left font-medium text-gray-600">
                      商品
                    </th>
                    <th className="pb-2 text-right font-medium text-gray-600">
                      數量
                    </th>
                    <th className="pb-2 text-right font-medium text-gray-600">
                      單價
                    </th>
                    <th className="pb-2 text-right font-medium text-gray-600">
                      小計
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item) => {
                    const productData = item.product as { name: string } | null;
                    const config = item.config_snapshot as Record<
                      string,
                      string
                    > | null;
                    return (
                      <tr key={item.id}>
                        <td className="py-2 pr-4">
                          {/* 快照優先（下單當下名稱）；join 現值僅供 null 窗口 fallback */}
                          <div>
                            {item.product_name_snapshot ??
                              productData?.name ??
                              item.product_id}
                          </div>
                          {config && Object.keys(config).length > 0 && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              {Object.entries(config)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(" · ")}
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-right">{item.quantity}</td>
                        <td className="py-2 text-right">
                          {formatCurrency(Number(item.unit_price_snapshot))}
                        </td>
                        <td className="py-2 text-right">
                          {formatCurrency(
                            Number(item.unit_price_snapshot) * item.quantity,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            {/* 付款資訊 */}
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-600 mb-4 uppercase tracking-wide">
                付款資訊
              </h2>
              {payment ? (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-gray-500">付款狀態</dt>
                    <dd
                      className={
                        payment.status === "paid"
                          ? "text-green-700 font-medium"
                          : "text-gray-700"
                      }
                    >
                      {payment.status === "paid"
                        ? "已付款"
                        : payment.status === "failed"
                          ? "失敗"
                          : "待付款"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">付款金額</dt>
                    <dd>{formatCurrency(Number(payment.amount))}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">MerchantTradeNo</dt>
                    <dd className="font-mono text-xs">
                      {payment.merchant_trade_no}
                    </dd>
                  </div>
                  {payment.gateway_trade_no && (
                    <div>
                      <dt className="text-gray-500">ECPay TradeNo</dt>
                      <dd className="font-mono text-xs">
                        {payment.gateway_trade_no}
                      </dd>
                    </div>
                  )}
                  {payment.paid_at && (
                    <div>
                      <dt className="text-gray-500">付款時間</dt>
                      <dd>{formatDateTime(payment.paid_at)}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-gray-400">尚無付款記錄</p>
              )}
            </section>

            {/* 狀態時間軸 */}
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-600 mb-4 uppercase tracking-wide">
                狀態紀錄
              </h2>
              {logs.length === 0 ? (
                <p className="text-sm text-gray-400">尚無狀態紀錄</p>
              ) : (
                <ol className="space-y-3">
                  {logs.map((log) => {
                    const actor = log.actor as { email: string } | null;
                    return (
                      <li key={log.id} className="flex gap-3 text-sm">
                        <div className="mt-1 w-2 h-2 rounded-full bg-gray-300 shrink-0" />
                        <div>
                          <div className="text-gray-700">
                            {log.from_status ? (
                              <>
                                <span className="font-medium">
                                  {STATUS_LABELS[
                                    log.from_status as OrderStatus
                                  ] ?? log.from_status}
                                </span>
                                {" → "}
                                <span className="font-medium">
                                  {STATUS_LABELS[
                                    log.to_status as OrderStatus
                                  ] ?? log.to_status}
                                </span>
                              </>
                            ) : (
                              <span className="font-medium">
                                {STATUS_LABELS[log.to_status as OrderStatus] ??
                                  log.to_status}
                              </span>
                            )}
                            {log.is_override && (
                              <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded">
                                Override
                              </span>
                            )}
                          </div>
                          <div className="text-gray-400 text-xs mt-0.5">
                            {formatDateTime(log.created_at)}
                            {actor?.email && ` · ${actor.email}`}
                            {log.note && ` · ${log.note}`}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>

          {/* 右欄：操作 */}
          <div>
            <div className="bg-white rounded-lg border border-gray-200 p-5 sticky top-8">
              <h2 className="text-sm font-semibold text-gray-600 mb-4 uppercase tracking-wide">
                操作
              </h2>
              <OrderActions
                orderId={order.id}
                currentStatus={order.status as OrderStatus}
                currentTrackingNo={order.tracking_no}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
