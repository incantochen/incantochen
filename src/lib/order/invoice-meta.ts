import { z } from "zod";

// orders.invoice_meta（jsonb）的單一出處（T42 code review 收斂）：原本發票去向
// 的三變體 union 在 checkout actions／create-order-from-cart／issue-invoice
// 三層各自手刻一套對映與欄位名，任何一層漏改就靜默 fallback 成個人發票
// （稅務可見的錯誤結果）。這裡集中：zod schema（讀取端驗形）＋雙向轉換函式。

// 結帳層收集的發票去向（camelCase，應用層型別）
export type InvoiceTargetInput =
  | { target: "personal" }
  | { target: "company"; customerIdentifier: string }
  | { target: "mobile_barcode"; carrierNum: string };

// jsonb 落庫形狀（snake_case）：結帳時寫入去向欄位，開立成功後併入
// random_number/invoice_date
export const invoiceMetaSchema = z.object({
  target: z.enum(["personal", "company", "mobile_barcode"]).optional(),
  customer_identifier: z.string().optional(),
  carrier_num: z.string().optional(),
  random_number: z.string().optional(),
  invoice_date: z.string().optional(),
});

export type InvoiceMeta = z.infer<typeof invoiceMetaSchema>;

// 開立層使用的判別 union（給 callIssue 組欄位）
export type InvoiceTarget =
  | { kind: "personal" }
  | { kind: "company"; taxId: string }
  | { kind: "mobile_barcode"; barcode: string };

export function invoiceTargetToMeta(input: InvoiceTargetInput): InvoiceMeta {
  switch (input.target) {
    case "company":
      return { target: "company", customer_identifier: input.customerIdentifier };
    case "mobile_barcode":
      return { target: "mobile_barcode", carrier_num: input.carrierNum };
    default:
      return { target: "personal" };
  }
}

// 讀取端：jsonb 是 unknown，先 zod 驗形再解讀；形狀不符或缺必要欄位一律
// fallback 個人發票（與寫入端缺席時的語意一致）
export function parseInvoiceTargetFromMeta(meta: unknown): InvoiceTarget {
  const parsed = invoiceMetaSchema.safeParse(meta);
  if (!parsed.success) return { kind: "personal" };
  const m = parsed.data;
  if (m.target === "company" && m.customer_identifier) {
    return { kind: "company", taxId: m.customer_identifier };
  }
  if (m.target === "mobile_barcode" && m.carrier_num) {
    return { kind: "mobile_barcode", barcode: m.carrier_num };
  }
  return { kind: "personal" };
}
