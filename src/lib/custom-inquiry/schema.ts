import { z } from "zod";

// 品項／預算帶的正規值（單一出處；與 migration 0022 的 check constraint 對齊）。
export const CATEGORY_VALUES = [
  "ring",
  "earring",
  "bracelet",
  "necklace",
  "unsure",
] as const;

export const BUDGET_VALUES = ["2-3", "3-5", "5plus", "chat"] as const;

export type CustomInquiryCategory = (typeof CATEGORY_VALUES)[number];
export type CustomInquiryBudget = (typeof BUDGET_VALUES)[number];

// 全客製預約／詢問表單（免登入，Email 即身分）。honeypot 欄位不在此 schema，
// 由 action 另行檢查（見 app/custom/actions.ts）。
export const customInquiryFormSchema = z.object({
  category: z.enum(CATEGORY_VALUES, { message: "請選擇想訂製的品項" }),
  budgetBand: z.enum(BUDGET_VALUES, { message: "請選擇預算範圍" }),
  idea: z
    .string()
    .trim()
    .min(1, "請描述妳的想法")
    .max(2000, "想法長度上限 2000 字"),
  email: z
    .string()
    .trim()
    .min(1, "請輸入 Email")
    .max(254, "Email 長度上限 254 字")
    .email("請輸入有效的 Email"),
  // 選填：空字串視同未填（transform 成 undefined，寫 DB 時存 null）
  phone: z
    .string()
    .trim()
    .max(40, "電話長度上限 40 字")
    .optional()
    .transform((v) => (v ? v : undefined)),
  preferredTime: z
    .string()
    .trim()
    .max(100, "長度上限 100 字")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type CustomInquiryFormValues = z.input<typeof customInquiryFormSchema>;
export type CustomInquiryParsedValues = z.output<typeof customInquiryFormSchema>;
