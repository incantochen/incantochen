import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ADMIN_STATUS_COLORS,
  STATUS_LABELS,
  type OrderStatus,
} from "@/lib/order/order-status";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { maskEmail, maskName } from "@/lib/pii/mask";
import { AdminPill } from "@/components/admin-pill";

const ALL_STATUSES: OrderStatus[] = [
  "pending_payment",
  "paid",
  "in_production",
  "shipped",
  "completed",
  "cancelled",
  "refunded",
];

const PAGE_SIZE = 20;

type SearchParams = {
  status?: string;
  q?: string;
  sort?: string;
  dir?: string;
  page?: string;
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const status = params.status as OrderStatus | undefined;
  const q = params.q ?? "";
  const sort = params.sort === "total_amount" ? "total_amount" : "created_at";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("orders")
    .select(
      `id, order_no, status, total_amount, recipient_name, created_at,
       member!inner(email)`,
      { count: "exact" },
    )
    .order(sort, { ascending: dir === "asc" })
    .range(from, to);

  if (status && ALL_STATUSES.includes(status)) {
    query = query.eq("status", status);
  }

  if (q.trim()) {
    query = query.or(`order_no.ilike.%${q}%,recipient_name.ilike.%${q}%`);
  }

  const { data: orders, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  function buildUrl(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = {
      status: status ?? "",
      q,
      sort,
      dir,
      page: String(page),
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) p.set(k, v);
    }
    return `/admin/orders?${p.toString()}`;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">訂單管理</h1>
        <Link
          href="/admin/orders/checkout"
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          建立訂單
        </Link>
      </div>

        {/* 狀態篩選 */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Link
            href={buildUrl({ status: undefined, page: "1" })}
            className={`px-3 py-1.5 rounded text-sm font-medium ${!status ? "bg-gray-900 text-white" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"}`}
          >
            全部 {!status && count != null ? `(${count})` : ""}
          </Link>
          {ALL_STATUSES.map((s) => (
            <Link
              key={s}
              href={buildUrl({ status: s, page: "1" })}
              className={`px-3 py-1.5 rounded text-sm font-medium ${status === s ? "bg-gray-900 text-white" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"}`}
            >
              {STATUS_LABELS[s]}
            </Link>
          ))}
        </div>

        {/* 搜尋 */}
        <form method="get" action="/admin/orders" className="mb-4 flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <input
            name="q"
            defaultValue={q}
            placeholder="搜尋訂單號 / 姓名 / Email"
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
          <button
            type="submit"
            className="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50"
          >
            搜尋
          </button>
          {q && (
            <Link
              href={buildUrl({ q: undefined, page: "1" })}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
            >
              清除
            </Link>
          )}
        </form>

        {/* 列表 */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  訂單號
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  客人
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  狀態
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">
                  <Link
                    href={buildUrl({
                      sort: "total_amount",
                      dir:
                        sort === "total_amount" && dir === "desc"
                          ? "asc"
                          : "desc",
                      page: "1",
                    })}
                  >
                    金額{" "}
                    {sort === "total_amount"
                      ? dir === "desc"
                        ? "↓"
                        : "↑"
                      : ""}
                  </Link>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  <Link
                    href={buildUrl({
                      sort: "created_at",
                      dir:
                        sort === "created_at" && dir === "desc"
                          ? "asc"
                          : "desc",
                      page: "1",
                    })}
                  >
                    建立時間{" "}
                    {sort === "created_at" ? (dir === "desc" ? "↓" : "↑") : ""}
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders?.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-gray-400"
                  >
                    沒有符合的訂單
                  </td>
                </tr>
              )}
              {orders?.map((order) => {
                const memberData = order.member as { email: string } | null;
                return (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {order.order_no}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div>{maskName(order.recipient_name)}</div>
                      <div className="text-gray-400 text-xs">
                        {memberData?.email ? maskEmail(memberData.email) : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <AdminPill
                        label={STATUS_LABELS[order.status as OrderStatus]}
                        color={ADMIN_STATUS_COLORS[order.status as OrderStatus]}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatCurrency(Number(order.total_amount))}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDateTime(order.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 分頁 */}
        {totalPages > 1 && (
          <div className="flex gap-2 mt-4 justify-center">
            {page > 1 && (
              <Link
                href={buildUrl({ page: String(page - 1) })}
                className="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                ← 上一頁
              </Link>
            )}
            <span className="px-3 py-1.5 text-sm text-gray-600">
              第 {page} / {totalPages} 頁
            </span>
            {page < totalPages && (
              <Link
                href={buildUrl({ page: String(page + 1) })}
                className="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                下一頁 →
              </Link>
            )}
          </div>
        )}
    </div>
  );
}
