import "server-only";
import { z } from "zod";
import { postInvoiceApi } from "./invoice-client";
import type { InvoiceTarget } from "@/lib/order/invoice-meta";

export type { InvoiceTarget };

// /B2CInvoice/Issue 欄位依官方規格（web_fetch 7896，2026-07-15 逐字核對）。
// 三種去向的合法組合（官方 Print×CarrierType 互斥規則）：
//   personal        → CarrierType='1'（綠界載具）＋Print='0'（載具 1/2 時 Print 只能 0）
//   mobile_barcode  → CarrierType='3'＋Print='0'（載具 3 時 Print 可 0/1）
//   company（統編） → CarrierType=''＋Print='1'（載具空時 Print 只能 1；
//                      Print=1 必填 CustomerName＋CustomerAddr）
// ⚠️ Print='0'＋統編＋空載具是官方明訂不合法組合，會被拒開——不要改回去。

export type IssueInvoiceItem = {
  name: string;
  quantity: number;
  unitPrice: number; // 含稅單價（vat=1）
};

export type IssueInvoiceParams = {
  relateNumber: string;
  target: InvoiceTarget;
  customerName: string;
  customerAddr: string; // company（Print=1）必填；其他去向不送
  customerPhone: string;
  customerEmail: string; // 空字串＝不送（Phone/Email 官方規則擇一即可）
  totalAmount: number; // 含稅總額，須等於 items 加總
  items: IssueInvoiceItem[];
};

const issueResultSchema = z.object({
  RtnCode: z.number(),
  RtnMsg: z.string(),
  InvoiceNo: z.string(),
  InvoiceDate: z.string(),
  RandomNumber: z.string(),
});

export type IssueInvoiceResult =
  | { ok: true; invoiceNo: string; invoiceDate: string; randomNumber: string }
  | { ok: false; error: string };

export async function callIssue(
  params: IssueInvoiceParams,
): Promise<IssueInvoiceResult> {
  const itemAmounts = params.items.map((i) => i.quantity * i.unitPrice);
  const itemsAmountSum = itemAmounts.reduce((a, b) => a + b, 0);
  if (itemsAmountSum !== params.totalAmount) {
    // 最後防線：呼叫端（issue-invoice.ts）已負責把運費等差額補成品項，
    // 走到這裡代表呼叫端組錯資料，擋下不送出避免 ECPay 端金額不符拒開
    return {
      ok: false,
      error: `商品金額加總（${itemsAmountSum}）與訂單總額（${params.totalAmount}）不符`,
    };
  }

  const target = params.target;
  const isCompany = target.kind === "company";
  const invoiceData: Record<string, unknown> = {
    RelateNumber: params.relateNumber,
    CustomerName: params.customerName,
    // Print=1（company）時 CustomerAddr 必填；其餘去向不送
    ...(isCompany ? { CustomerAddr: params.customerAddr } : {}),
    CustomerPhone: params.customerPhone,
    // Phone/Email 至少一項；email 可能因超過 ECPay 80 字上限被呼叫端清空
    ...(params.customerEmail ? { CustomerEmail: params.customerEmail } : {}),
    Print: isCompany ? "1" : "0",
    Donation: "0",
    CarrierType:
      target.kind === "mobile_barcode" ? "3" : target.kind === "personal" ? "1" : "",
    ...(target.kind === "mobile_barcode" ? { CarrierNum: target.barcode } : {}),
    ...(isCompany ? { CustomerIdentifier: target.taxId } : {}),
    TaxType: "1", // 應稅（珠寶零售一般商品）
    SalesAmount: params.totalAmount,
    InvType: "07", // 一般發票
    vat: "1", // 金額含稅
    Items: params.items.map((item, index) => ({
      ItemSeq: index + 1,
      ItemName: item.name,
      ItemCount: item.quantity,
      ItemWord: "件",
      ItemPrice: item.unitPrice,
      ItemAmount: item.quantity * item.unitPrice,
    })),
  };

  const result = await postInvoiceApi(
    "/B2CInvoice/Issue",
    invoiceData,
    issueResultSchema,
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    invoiceNo: result.data.InvoiceNo,
    invoiceDate: result.data.InvoiceDate,
    randomNumber: result.data.RandomNumber,
  };
}

// /B2CInvoice/GetIssue：以 RelateNumber 查詢既有發票（官方 7923：RelateNumber
// 可單獨查詢）。用途＝Issue 失敗時的冪等判別——若查得到，代表這張發票先前
// 已在 ECPay 端開立成功（例如上次呼叫成功但本地寫入被中斷），比對 RtnMsg
// 文字猜「重複」穩健得多，而且能拿回真實發票號碼。
const getIssueResultSchema = z.object({
  RtnCode: z.number(),
  RtnMsg: z.string(),
  IIS_Number: z.string(),
  IIS_Create_Date: z.string(),
  IIS_Random_Number: z.string(),
});

export type GetIssueResult =
  | { found: true; invoiceNo: string; invoiceDate: string; randomNumber: string }
  | { found: false };

export async function getIssueByRelateNumber(
  relateNumber: string,
): Promise<GetIssueResult> {
  const result = await postInvoiceApi(
    "/B2CInvoice/GetIssue",
    { RelateNumber: relateNumber },
    getIssueResultSchema,
  );
  if (!result.ok) {
    // 查無此發票與查詢失敗都回 found:false——呼叫端把「Issue 失敗且查無既有
    // 發票」視為真正失敗，語意一致
    return { found: false };
  }
  return {
    found: true,
    invoiceNo: result.data.IIS_Number,
    invoiceDate: result.data.IIS_Create_Date,
    randomNumber: result.data.IIS_Random_Number,
  };
}
