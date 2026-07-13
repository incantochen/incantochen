"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth/require-admin"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { productFormSchema, type ProductFormValues } from "@/lib/product/schema"

export type ProductActionResult =
  | { ok: true; id: string }
  | {
      ok: false
      error: string
      fieldErrors?: Partial<Record<keyof ProductFormValues, string>>
    }

function flattenFieldErrors(
  error: import("zod").ZodError<ProductFormValues>,
): Partial<Record<keyof ProductFormValues, string>> {
  const fieldErrors: Partial<Record<keyof ProductFormValues, string>> = {}
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof ProductFormValues | undefined
    if (key && !fieldErrors[key]) {
      fieldErrors[key] = issue.message
    }
  }
  return fieldErrors
}

const SLUG_CONFLICT_ERROR = "此網址代稱（slug）已被使用，請換一個"

export async function createProduct(
  values: ProductFormValues,
): Promise<ProductActionResult> {
  await requireAdmin()

  const parsed = productFormSchema.safeParse(values)
  if (!parsed.success) {
    return {
      ok: false,
      error: "請確認欄位內容",
      fieldErrors: flattenFieldErrors(parsed.error),
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
  return { ok: true, id: data.id }
}

export async function updateProduct(
  id: string,
  values: ProductFormValues,
): Promise<ProductActionResult> {
  await requireAdmin()

  const parsed = productFormSchema.safeParse(values)
  if (!parsed.success) {
    return {
      ok: false,
      error: "請確認欄位內容",
      fieldErrors: flattenFieldErrors(parsed.error),
    }
  }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from("product")
    .update(parsed.data)
    .eq("id", id)

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: SLUG_CONFLICT_ERROR, fieldErrors: { slug: SLUG_CONFLICT_ERROR } }
    }
    return { ok: false, error: "更新商品失敗，請稍後再試" }
  }

  revalidatePath("/admin/products")
  revalidatePath(`/admin/products/${id}`)
  revalidatePath(`/products/${parsed.data.slug}`)
  return { ok: true, id }
}
