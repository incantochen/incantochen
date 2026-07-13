import { requireAdmin } from "@/lib/auth/require-admin"
import { AdminProductForm } from "@/components/admin-product-form"

export default async function NewProductPage() {
  await requireAdmin()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">新增商品</h1>
      <AdminProductForm mode="create" />
    </div>
  )
}
