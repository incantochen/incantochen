import { z } from "zod"
import { ALL_CATEGORIES } from "@/lib/product/category-labels"
import { ALL_PRODUCT_STATUSES } from "@/lib/product/product-status"

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SLUG_FORMAT_MESSAGE = "僅能使用小寫英文、數字與連字號（例如 emerald-solitaire-ring）"

const slugBase = z.string().trim().min(1, "請輸入網址代稱").max(100, "網址代稱過長")

export const productFormSchema = z.object({
  slug: slugBase.regex(SLUG_FORMAT, SLUG_FORMAT_MESSAGE),
  name: z.string().trim().min(1, "請輸入商品名稱").max(100, "商品名稱過長"),
  category: z.enum(ALL_CATEGORIES, { message: "請選擇品類" }),
  base_price: z.coerce
    .number({ message: "請輸入底價" })
    .int("底價須為整數")
    .min(0, "底價不可為負數")
    .max(99_999_999, "底價超出上限"),
  status: z.enum(ALL_PRODUCT_STATUSES, { message: "請選擇狀態" }),
})

export type ProductFormValues = z.infer<typeof productFormSchema>

// 更新時若 slug 未變更，放行既有值即使不符合新格式（欄位新增驗證前建立的舊
// 商品不會因此卡住其他欄位的編輯，例如只是改個底價）；slug 若真的被改動，
// 新值仍須符合格式。
export function productUpdateSchema(currentSlug: string) {
  return productFormSchema.extend({
    slug: slugBase.superRefine((value, ctx) => {
      if (value === currentSlug) return
      if (!SLUG_FORMAT.test(value)) {
        ctx.addIssue({ code: "custom", message: SLUG_FORMAT_MESSAGE })
      }
    }),
  })
}
