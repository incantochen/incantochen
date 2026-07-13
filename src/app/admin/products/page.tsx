import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CATEGORY_LABELS } from "@/lib/product/category-labels";
import type { Database } from "@/types/database.types";

type ProductStatus = Database["public"]["Enums"]["product_status"];

// label 與 badge 色綁在同一筆，新增狀態時不會只改到其中一張表
const STATUS_META: Record<ProductStatus, { label: string; color: string }> = {
  draft: { label: "草稿", color: "bg-amber-100 text-amber-800" },
  active: { label: "上架中", color: "bg-green-100 text-green-800" },
  archived: { label: "已封存", color: "bg-gray-100 text-gray-700" },
};

export default async function AdminProductsPage() {
  await requireAdmin();

  const supabase = createServiceRoleClient();
  const { data: products, error } = await supabase
    .from("product")
    .select("id, name, slug, category, status, product_image(count)")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`查詢商品列表失敗：${error.message}`);
  }

  // 查詢形狀（product_image: [{ count }]）在這裡攤平，展示層只拿 image_count
  const rows = (products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    category: p.category,
    status: p.status,
    imageCount: p.product_image[0]?.count ?? 0,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">商品管理</h1>
        <p className="mt-1 text-sm text-gray-500">
          目前僅提供圖片管理；商品建立／編輯功能後續開放（T10）
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                商品
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                品類
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                狀態
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">
                圖片數
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  尚無商品
                </td>
              </tr>
            )}
            {rows.map((product) => (
              <tr key={product.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">
                    {product.name}
                  </div>
                  <div className="text-gray-400 text-xs font-mono">
                    {product.slug}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {CATEGORY_LABELS[product.category]}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[product.status].color}`}
                  >
                    {STATUS_META[product.status].label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">{product.imageCount}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/products/${product.id}/images`}
                    className="text-blue-600 hover:underline"
                  >
                    圖片管理
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
