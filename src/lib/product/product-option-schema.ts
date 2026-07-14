import { z } from "zod";

// price_delta 對齊 DB check（numeric(12,0) >= 0）：整數 NT$、非負、有上限防手誤
// 打成天價。表單傳字串進來——用 ^\d+$ 一次擋掉空字串（避免 z.coerce.number("")
// 靜默變 0）、負號、小數點與非數字，再轉成數字並驗上限。
export const priceDeltaSchema = z
  .string({ message: "請輸入加價金額" })
  .trim()
  .regex(/^\d+$/, "加價須為非負整數")
  .transform((s) => Number(s))
  .refine((n) => n <= 9_999_999, "加價金額過大");

export const addProductOptionSchema = z.object({
  productId: z.string().uuid(),
  optionTypeId: z.string().uuid({ message: "請選擇選項類型" }),
  required: z.boolean(),
});
export type AddProductOptionValues = z.infer<typeof addProductOptionSchema>;

export const addProductOptionValueSchema = z.object({
  productOptionId: z.string().uuid(),
  optionValueId: z.string().uuid({ message: "請選擇選項值" }),
  priceDelta: priceDeltaSchema,
  isDefault: z.boolean(),
});
export type AddProductOptionValueValues = z.infer<
  typeof addProductOptionValueSchema
>;
