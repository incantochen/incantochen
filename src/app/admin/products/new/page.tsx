import { requireAdmin } from "@/lib/auth/require-admin"
import { AdminProductForm } from "@/components/admin-product-form"

export default async function NewProductPage() {
  await requireAdmin()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">新增商品</h1>
        <AdminProductForm mode="create" />
      </div>
    </div>
  )
}
