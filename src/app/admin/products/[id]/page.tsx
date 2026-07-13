import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth/require-admin"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { AdminProductForm } from "@/components/admin-product-form"

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params

  const supabase = createServiceRoleClient()
  const { data: product } = await supabase
    .from("product")
    .select("id, slug, name, category, base_price, status")
    .eq("id", id)
    .maybeSingle()

  if (!product) notFound()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">編輯商品</h1>
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
    </div>
  )
}
