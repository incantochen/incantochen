import { z } from "zod";

// price_delta 對齊 DB check（numeric(12,0) >= 0）：整數 NT$、非負、有上限防手誤
// 打成天價；表單傳字串進來，先 coerce 再驗
export const priceDeltaSchema = z.coerce
  .number({ message: "請輸入加價金額" })
  .int("加價須為整數")
  .min(0, "加價不可為負")
  .max(9_999_999, "加價金額過大");

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
