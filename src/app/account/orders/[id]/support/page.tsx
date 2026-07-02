import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import type { OrderStatus } from "@/lib/order/order-status";
import {
  CUSTOM_NO_RETURN_NOTICE,
  REQUEST_TYPE_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_PILL_STYLES,
  canRequestSupport,
  type SupportRequestStatus,
  type SupportRequestType,
} from "@/lib/support/support-request";
import { SupportRequestForm } from "@/components/support-request-form";

export default async function SupportRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, order_no, status")
    .eq("id", id)
    .eq("member_id", user.id)
    .maybeSingle();

  if (!order) notFound();

  const { data: requests } = await supabase
    .from("support_request")
    .select("id, request_type, status, created_at")
    .eq("order_id", id)
    .order("created_at", { ascending: false });

  const eligible = canRequestSupport(order.status as OrderStatus);
  const existing = requests ?? [];

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link
          href={`/account/orders/${order.id}`}
          className="text-sm text-ash hover:text-ink"
        >
          ← {order.order_no}
        </Link>
        <h2 className="mt-2 font-heading text-2xl text-ink">商品問題回報</h2>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
        {CUSTOM_NO_RETURN_NOTICE}
      </div>

      {existing.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] tracking-[0.16em] text-ash uppercase">
            既有申請紀錄
          </h3>
          {existing.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm"
            >
              <div>
                <div className="text-ink">
                  {REQUEST_TYPE_LABELS[r.request_type as SupportRequestType]}
                </div>
                <div className="mt-0.5 text-xs text-ash">
                  {formatDateTime(r.created_at)}
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] tracking-[0.08em] ${SUPPORT_STATUS_PILL_STYLES[r.status as SupportRequestStatus]}`}
              >
                {SUPPORT_STATUS_LABELS[r.status as SupportRequestStatus]}
              </span>
            </div>
          ))}
        </div>
      )}

      {eligible ? (
        <div className="rounded-lg border border-border p-6">
          {existing.length > 0 && (
            <p className="mb-4 text-sm text-ash">
              此訂單已有申請紀錄，若為補充說明可再次送出。
            </p>
          )}
          <SupportRequestForm orderId={order.id} />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-cloud px-6 py-10 text-center text-ash">
          此訂單目前無法申請售後，
          <Link
            href={`/account/orders/${order.id}`}
            className="text-primary underline underline-offset-2"
          >
            返回訂單詳情
          </Link>
        </div>
      )}
    </div>
  );
}
