import { z } from "zod"

// T42：發票去向三選一互斥（ECPay 官方規則：捐贈／統編／載具不可並存；本站
// MVP 不做捐贈，僅開放個人／公司／手機條碼載具三選）。統編＋手機條碼的格式
// 交給 zod 做前端即時提示，真正擋單以 ECPay 驗證 API（validate.ts）為準——
// 這裡只是防呆，不是唯一防線。
const TAX_ID_FORMAT = /^\d{8}$/
const BARCODE_FORMAT = /^\/[0-9A-Z.+-]{7}$/

export const checkoutFormSchema = z
  .object({
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
    // optional + default('personal')：admin 代客建單（T111）共用此 schema 但
    // 目前不收發票去向 UI，缺省時視同個人發票（綠界載具），不因此擋單
    invoiceTarget: z
      .enum(["personal", "company", "mobile_barcode"])
      .default("personal"),
    taxId: z.string().optional(),
    carrierBarcode: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.invoiceTarget === "company") {
      if (!values.taxId || !TAX_ID_FORMAT.test(values.taxId)) {
        ctx.addIssue({
          code: "custom",
          path: ["taxId"],
          message: "請輸入 8 碼數字統一編號",
        })
      }
    }
    if (values.invoiceTarget === "mobile_barcode") {
      if (!values.carrierBarcode || !BARCODE_FORMAT.test(values.carrierBarcode)) {
        ctx.addIssue({
          code: "custom",
          path: ["carrierBarcode"],
          message: "請輸入正確格式的手機條碼（/ 開頭共 8 碼）",
        })
      }
    }
  })

export type CheckoutFormValues = z.infer<typeof checkoutFormSchema>
