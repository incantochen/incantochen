import { z } from "zod";

// 客人表單：無類型選擇（一律 return_defect，action 內寫死）
export const supportRequestFormSchema = z.object({
  description: z
    .string()
    .trim()
    .min(10, "請至少填寫 10 個字，說明狀況")
    .max(2000, "說明長度上限 2000 字"),
});
export type SupportRequestFormValues = z.infer<typeof supportRequestFormSchema>;

// 後台手動建立售服案件：類型可選
export const adminSupportCaseSchema = z.object({
  requestType: z.enum(["return_defect", "repair_maintenance"], {
    message: "請選擇案件類型",
  }),
  description: supportRequestFormSchema.shape.description,
});
export type AdminSupportCaseValues = z.infer<typeof adminSupportCaseSchema>;
