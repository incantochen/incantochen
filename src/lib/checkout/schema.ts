import { z } from "zod"

export const checkoutFormSchema = z.object({
  email: z.string().min(1, "請輸入 Email").email("請輸入有效的 Email"),
  recipientName: z.string().min(1, "請輸入收件人姓名"),
  recipientPhone: z
    .string()
    .min(1, "請輸入電話")
    .regex(/^[0-9-]{8,15}$/, "請輸入有效的電話號碼"),
  zipCode: z.string().regex(/^\d{3}(\d{2})?$/, "請輸入有效的郵遞區號（3 或 5 碼數字）"),
  shippingAddress: z.string().min(1, "請輸入地址"),
  customConsent: z.literal(true, { message: "請勾選同意後再繼續" }),
})

export type CheckoutFormValues = z.infer<typeof checkoutFormSchema>
