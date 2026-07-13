import { z } from "zod";
import { ALL_APPLIES_TO, ALL_INPUT_TYPES } from "@/lib/option/labels";

// code 建立後鎖定（決策 2026-07-13）：config_snapshot 內嵌 code、驗價白名單
// 以 code 匹配，改 code 會讓進行中購物車結帳失敗——update schema 一律不含 code
const CODE_FORMAT = /^[a-z0-9_]+$/;
const CODE_FORMAT_MESSAGE = "僅能使用小寫英文、數字與底線（例如 gem_color）";

const codeBase = z
  .string()
  .trim()
  .min(1, "請輸入代碼")
  .max(50, "代碼過長")
  .regex(CODE_FORMAT, CODE_FORMAT_MESSAGE);

// swatch_hex 對齊 DB check constraint（0012：^#[0-9A-Fa-f]{6}$）；
// 表單空字串視為「清除色票」轉 null
const swatchHexBase = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, "色碼格式須為 #RRGGBB（例如 #1A6B54）")
  .nullable();

export const optionTypeFormSchema = z.object({
  code: codeBase,
  name: z.string().trim().min(1, "請輸入名稱").max(100, "名稱過長"),
  applies_to: z.enum(ALL_APPLIES_TO, { message: "請選擇適用品類" }),
  input_type: z.enum(ALL_INPUT_TYPES, { message: "請選擇輸入形式" }),
});

export type OptionTypeFormValues = z.infer<typeof optionTypeFormSchema>;

export const optionTypeUpdateSchema = optionTypeFormSchema.omit({
  code: true,
});

export type OptionTypeUpdateValues = z.infer<typeof optionTypeUpdateSchema>;

export const optionValueFormSchema = z.object({
  code: codeBase,
  label: z.string().trim().min(1, "請輸入顯示名稱").max(100, "顯示名稱過長"),
  swatch_hex: swatchHexBase,
});

export type OptionValueFormValues = z.infer<typeof optionValueFormSchema>;

export const optionValueUpdateSchema = optionValueFormSchema.omit({
  code: true,
});

export type OptionValueUpdateValues = z.infer<typeof optionValueUpdateSchema>;
