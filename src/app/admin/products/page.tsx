import Link from "next/link"
import { requireAdmin } from "@/lib/auth/require-admin"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { formatCurrency, formatDateTime } from "@/lib/utils"
import { CATEGORY_LABELS } from "@/lib/product/category"
import {
  ALL_PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUS_PILL_STYLES,
  type ProductStatus,
} from "@/lib/product/product-status"
import { AdminFilterPills } from "@/components/admin-filter-pills"
import { StatusPill } from "@/components/status-pill"

type SearchParams = {
  status?: string
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireAdmin()

  const params = await searchParams
  const status =
    params.status && ALL_PRODUCT_STATUSES.includes(params.status as ProductStatus)
      ? (params.status as ProductStatus)
      : undefined

  const supabase = createServiceRoleClient()
  let query = supabase
    .from("product")
    .select("id, slug, name, category, base_price, status, updated_at")
    .order("updated_at", { ascending: false })

  query = status ? query.eq("status", status) : query.in("status", ["active", "draft"])

  const { data: products, error } = await query
  if (error) {
    throw new Error(`載入商品列表失敗：${error.message}`)
  }

  function buildUrl(nextStatus: string | undefined) {
    return nextStatus ? `/admin/products?status=${nextStatus}` : "/admin/products"
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">商品管理</h1>
        <Link
          href="/admin/products/new"
          className="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700"
        >
          + 新增商品
        </Link>
      </div>

      {/* 狀態篩選 */}
      <AdminFilterPills
        items={[
          { key: "default", label: "上架中＋草稿", href: buildUrl(undefined), active: !status },
          ...ALL_PRODUCT_STATUSES.map((s) => ({
            key: s,
            label: PRODUCT_STATUS_LABELS[s],
            href: buildUrl(s),
            active: status === s,
          })),
        ]}
      />

      {/* 列表 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">商品</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">品類</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">底價</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">狀態</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">更新時間</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  沒有符合的商品
                </td>
              </tr>
            )}
            {products.map((product) => (
              <tr key={product.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/products/${product.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {product.name}
                  </Link>
                  <div className="text-gray-400 text-xs font-mono">{product.slug}</div>
                </td>
                <td className="px-4 py-3">{CATEGORY_LABELS[product.category]}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(Number(product.base_price))}</td>
                <td className="px-4 py-3">
                  <StatusPill
                    label={PRODUCT_STATUS_LABELS[product.status]}
                    colorClass={PRODUCT_STATUS_PILL_STYLES[product.status]}
                  />
                </td>
                <td className="px-4 py-3 text-gray-500">{formatDateTime(product.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
