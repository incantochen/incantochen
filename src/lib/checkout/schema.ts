import { z } from "zod"

export const checkoutFormSchema = z.object({
  email: z
    .string()
    .min(1, "請輸入 Email")
    .max(254, "Email 長度上限 254 字")
    .email("請輸入有效的 Email"),
  recipientName: z
    .string()
    .min(1, "請輸入收件人姓名")
    .max(50, "收件人姓名長度上限 50 字"),
  recipientPhone: z
    .string()
    .min(1, "請輸入電話")
    .regex(/^[0-9-]{8,15}$/, "請輸入有效的電話號碼"),
  zipCode: z.string().regex(/^\d{3}(\d{2})?$/, "請輸入有效的郵遞區號（3 或 5 碼數字）"),
  shippingAddress: z
    .string()
    .min(1, "請輸入地址")
    .max(200, "地址長度上限 200 字"),
  customConsent: z.literal(true, { message: "請勾選同意後再繼續" }),
})

export type CheckoutFormValues = z.infer<typeof checkoutFormSchema>
