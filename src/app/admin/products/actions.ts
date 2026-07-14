"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth/require-admin"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { flattenFieldErrors } from "@/lib/zod/flatten-field-errors"
import { REFRESH_TO_RETRY_SUFFIX } from "@/lib/concurrency-message"
import { PRODUCT_STATUS_META } from "@/lib/product/product-status"
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

const RACE_MESSAGE = `此商品已被其他管理員異動${REFRESH_TO_RETRY_SUFFIX}`

async function buildSlugConflictError(
  supabase: ReturnType<typeof createServiceRoleClient>,
  slug: string,
): Promise<ProductActionResult> {
  const { data: conflict } = await supabase
    .from("product")
    .select("name, status")
    .eq("slug", slug)
    .maybeSingle()

  const error = conflict
    ? `此網址代稱（slug）已被「${conflict.name}」使用（狀態：${PRODUCT_STATUS_META[conflict.status].label}），請換一個`
    : "此網址代稱（slug）已被使用，請換一個"

  return { ok: false, error, fieldErrors: { slug: error } }
}

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
      return buildSlugConflictError(supabase, parsed.data.slug)
    }
    return { ok: false, error: "建立商品失敗，請稍後再試" }
  }

  revalidatePath("/admin/products")
  return { ok: true, id: data.id, affectedRows: 1 }
}

// 只跟 productFormSchema 實際定義的欄位比對（而非手 key 一份欄位清單），
// 之後 schema 加新欄位時這裡會自動涵蓋到，不會漏掉某欄位變更卻被誤判成
// no-op（F-型缺口：漏更新自己不會發現）。
function isUnchanged(values: ProductFormValues, original: ProductFormValues) {
  return (Object.keys(productFormSchema.shape) as (keyof ProductFormValues)[]).every(
    (key) => values[key] === original[key],
  )
}

// guard 是編輯頁載入當下讀到的值（非表單目前選取值）：
// - guard.updatedAt 作為條件式 UPDATE 的樂觀鎖 token（比照 order 狀態轉換，
//   CLAUDE.md §6「並發去重用條件式 UPDATE」）——用 updated_at 而非只比對
//   status，任何欄位的並發異動都會讓 updated_at 不同，CAS 才真正涵蓋「兩個
//   分頁改不同欄位」的情境，不會只擋到「剛好都改 status」的窄情境。
// - guard.values.slug 用來讓格式驗證只套用在「這次真的有改 slug」的情況，
//   避免新規則卡住舊資料的其他欄位編輯。
// - guard.values 整組拿來跟送出值比對：完全沒變更就不送 UPDATE，避免每次
//   按儲存都白白觸發 trg_product_updated_at 把 updated_at 推到現在，讓
//   「最後更新」時間失去意義；但仍會做一次唯讀查詢確認 updated_at 沒有
//   在使用者看畫面的期間被別人動過，不能因為「這次沒變更」就跳過偵測。
export async function updateProduct(
  id: string,
  values: ProductFormValues,
  guard: { values: ProductFormValues; updatedAt: string },
): Promise<ProductActionResult> {
  await requireAdmin()

  const parsed = productUpdateSchema(guard.values.slug).safeParse(values)
  if (!parsed.success) {
    return {
      ok: false,
      error: "請確認欄位內容",
      fieldErrors: flattenFieldErrors<keyof ProductFormValues>(parsed.error),
    }
  }

  const supabase = createServiceRoleClient()

  // 品類一旦有配置器選項（product_option）掛在上面，任意切換品類會讓既有
  // 選項與新品類的 applies_to 白名單脫鉤，且沒有 DB 層約束擋這件事，故先擋
  // 下。T13 後台「選項設定」頁已可管理這些對應——要換品類請先於該頁移除所有
  // 選項對應再回來改，維持鎖定行為不變（避免無聲留下脫鉤資料）。
  if (parsed.data.category !== guard.values.category) {
    const { count, error: countError } = await supabase
      .from("product_option")
      .select("id", { count: "exact", head: true })
      .eq("product_id", id)
    if (countError) {
      return { ok: false, error: "檢查商品選項設定失敗，請稍後再試" }
    }
    if (count && count > 0) {
      return {
        ok: false,
        error: "此商品已設定配置器選項，無法變更品類（會讓既有選項與新品類的白名單脫鉤）",
        fieldErrors: { category: "已有選項設定，無法變更品類" },
      }
    }
  }

  if (isUnchanged(parsed.data, guard.values)) {
    // 沒有欄位要寫入，但仍需確認資料沒有在使用者瀏覽期間被別人異動過，
    // 否則「已儲存」的訊息會誤導使用者以為畫面上看到的就是最新狀態。
    const { data: current, error: checkError } = await supabase
      .from("product")
      .select("updated_at")
      .eq("id", id)
      .maybeSingle()
    if (checkError) {
      return { ok: false, error: "確認商品狀態失敗，請稍後再試" }
    }
    if (!current || current.updated_at !== guard.updatedAt) {
      return { ok: false, error: RACE_MESSAGE }
    }
    return { ok: true, id, affectedRows: 0 }
  }

  const { data, error } = await supabase
    .from("product")
    .update(parsed.data)
    .eq("id", id)
    .eq("updated_at", guard.updatedAt)
    .select("id")

  if (error) {
    if (error.code === "23505") {
      return buildSlugConflictError(supabase, parsed.data.slug)
    }
    return { ok: false, error: "更新商品失敗，請稍後再試" }
  }

  // 0 列命中：id 不存在（例如已被其他方式移除），或 updated_at 已被其他
  // 分頁／管理員的異動推進（CAS 守衛擋下，不論對方改的是哪個欄位）。
  // 兩種情況都不該回報成功。
  if (!data || data.length === 0) {
    return { ok: false, error: RACE_MESSAGE }
  }

  revalidatePath("/admin/products")
  revalidatePath(`/admin/products/${id}`)
  revalidatePath(`/products/${parsed.data.slug}`)
  return { ok: true, id, affectedRows: data.length }
}
