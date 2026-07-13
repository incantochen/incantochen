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
  const [{ data: product, error }, { count: optionCount, error: optionError }] =
    await Promise.all([
      supabase
        .from("product")
        .select("id, slug, name, category, base_price, status, updated_at")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("product_option")
        .select("id", { count: "exact", head: true })
        .eq("product_id", id),
    ])

  if (error) {
    throw new Error(`載入商品失敗：${error.message}`)
  }
  if (optionError) {
    throw new Error(`載入商品選項設定失敗：${optionError.message}`)
  }
  if (!product) notFound()

  const parsedAffected = Number(affected)
  const affectedRows = Number.isFinite(parsedAffected) ? parsedAffected : 0

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">編輯商品</h1>
        <span className="text-sm text-gray-500">
          最後更新：{formatDateTime(product.updated_at)}
        </span>
      </div>
      {saved === "1" && (
        <SavedBanner
          key={`${product.updated_at}-${affectedRows}`}
          affectedRows={affectedRows}
          updatedAt={product.updated_at}
        />
      )}
      <AdminProductForm
        // updated_at 變了就換一個 key，強制整個表單重新掛載：本地表單狀態
        // 是儲存當下 mount 時讀進來的一次性快照，不會自己跟著新的
        // initialValues 重新同步；靠 key 換掉 instance 而不是只更新 props，
        // 才能讓「這次沒改任何欄位、但別人已經動過這筆資料」的情境，在畫面
        // 上正確換成最新內容，而不是繼續顯示使用者原本看到的舊值。
        key={product.updated_at}
        mode="edit"
        productId={product.id}
        initialValues={{
          slug: product.slug,
          name: product.name,
          category: product.category,
          base_price: Number(product.base_price),
          status: product.status,
        }}
        updatedAt={product.updated_at}
        hasConfiguredOptions={(optionCount ?? 0) > 0}
      />
    </div>
  )
}
