import { z } from "zod"
import { ALL_CATEGORIES } from "@/lib/product/category"
import { ALL_PRODUCT_STATUSES } from "@/lib/product/product-status"

export const productFormSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, "請輸入網址代稱")
    .max(100, "網址代稱過長")
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "僅能使用小寫英文、數字與連字號（例如 emerald-solitaire-ring）"),
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
