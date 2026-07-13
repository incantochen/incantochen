"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth/require-admin"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { flattenFieldErrors } from "@/lib/zod/flatten-field-errors"
import {
  productFormSchema,
  productUpdateSchema,
  type ProductFormValues,
} from "@/lib/product/schema"

export type ProductActionResult =
  | { ok: true; id: string; affectedRows: number }
  | {
      ok: false
      error: string
      fieldErrors?: Partial<Record<keyof ProductFormValues, string>>
    }

const SLUG_CONFLICT_ERROR = "此網址代稱（slug）已被使用，請換一個"
const RACE_MESSAGE = "此商品已被其他管理員異動，請重新整理頁面確認最新狀態後再操作"

export async function createProduct(
  values: ProductFormValues,
): Promise<ProductActionResult> {
  await requireAdmin()

  const parsed = productFormSchema.safeParse(values)
  if (!parsed.success) {
    return {
      ok: false,
      error: "請確認欄位內容",
      fieldErrors: flattenFieldErrors<keyof ProductFormValues>(parsed.error),
    }
  }

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("product")
    .insert(parsed.data)
    .select("id")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: SLUG_CONFLICT_ERROR, fieldErrors: { slug: SLUG_CONFLICT_ERROR } }
    }
    return { ok: false, error: "建立商品失敗，請稍後再試" }
  }

  revalidatePath("/admin/products")
  return { ok: true, id: data.id, affectedRows: 1 }
}

function isUnchanged(values: ProductFormValues, original: ProductFormValues) {
  return (
    values.slug === original.slug &&
    values.name === original.name &&
    values.category === original.category &&
    values.base_price === original.base_price &&
    values.status === original.status
  )
}

// original 是編輯頁載入當下讀到的值（非表單目前選取值）：
// - status 作為條件式 UPDATE 的 CAS 守衛（比照 order 狀態轉換，CLAUDE.md
//   §6「並發去重用條件式 UPDATE」），防止分頁 A 覆寫分頁 B 剛做的封存／上架。
// - slug 用來讓格式驗證只套用在「這次真的有改 slug」的情況，避免新規則卡住
//   舊資料的其他欄位編輯。
// - 整組拿來跟送出值比對：完全沒變更就不送 UPDATE，避免每次按儲存都白白
//   觸發 trg_product_updated_at 把 updated_at 推到現在，讓「最後更新」時間
//   失去意義。
export async function updateProduct(
  id: string,
  values: ProductFormValues,
  original: ProductFormValues,
): Promise<ProductActionResult> {
  await requireAdmin()

  const parsed = productUpdateSchema(original.slug).safeParse(values)
  if (!parsed.success) {
    return {
      ok: false,
      error: "請確認欄位內容",
      fieldErrors: flattenFieldErrors<keyof ProductFormValues>(parsed.error),
    }
  }

  if (isUnchanged(parsed.data, original)) {
    return { ok: true, id, affectedRows: 0 }
  }

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("product")
    .update(parsed.data)
    .eq("id", id)
    .eq("status", original.status)
    .select("id")

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: SLUG_CONFLICT_ERROR, fieldErrors: { slug: SLUG_CONFLICT_ERROR } }
    }
    return { ok: false, error: "更新商品失敗，請稍後再試" }
  }

  // 0 列命中：id 不存在（例如已被其他方式移除），或 status 已被其他分頁／
  // 管理員異動（CAS 守衛擋下）。兩種情況都不該回報成功。
  if (!data || data.length === 0) {
    return { ok: false, error: RACE_MESSAGE }
  }

  revalidatePath("/admin/products")
  revalidatePath(`/admin/products/${id}`)
  revalidatePath(`/products/${parsed.data.slug}`)
  return { ok: true, id, affectedRows: data.length }
}
