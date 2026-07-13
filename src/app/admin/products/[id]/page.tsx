import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth/require-admin"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { AdminProductForm } from "@/components/admin-product-form"
import { SavedBanner } from "@/components/saved-banner"
import { formatDateTime } from "@/lib/utils"

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ saved?: string; affected?: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const { saved, affected } = await searchParams

  const supabase = createServiceRoleClient()
  const { data: product, error } = await supabase
    .from("product")
    .select("id, slug, name, category, base_price, status, updated_at")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    throw new Error(`載入商品失敗：${error.message}`)
  }
  if (!product) notFound()

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">編輯商品</h1>
        <span className="text-sm text-gray-500">
          最後更新：{formatDateTime(product.updated_at)}
        </span>
      </div>
      {saved === "1" && (
        <SavedBanner affectedRows={Number(affected ?? "0")} updatedAt={product.updated_at} />
      )}
      <AdminProductForm
        mode="edit"
        productId={product.id}
        initialValues={{
          slug: product.slug,
          name: product.name,
          category: product.category,
          base_price: Number(product.base_price),
          status: product.status,
        }}
      />
    </div>
  )
}
