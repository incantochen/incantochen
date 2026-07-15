import "server-only";
import { z } from "zod";
import { postInvoiceApi } from "./invoice-client";

// 統一編號驗證。官方端點是 /B2CInvoice/GetCompanyNameByTaxID（欄位
// UnifiedBusinessNo），不是文件標題暗示的 CheckCompanyIdentifier——本檔實作
// 依 2026-07 web_fetch 官方頁面（32089）核對過，勿依標題直覺誤用端點名。
// 官方規則：只有 RtnCode=1200125（統編檢查碼驗證失敗）才擋下開立；其餘失敗
// （查無資料、財政部 API 逾時等）不代表統編無效，不應阻擋開立。
const checkCompanySchema = z.object({
  RtnCode: z.number(),
  RtnMsg: z.string(),
  CompanyName: z.string().optional(),
});

export async function checkCompanyIdentifier(
  taxId: string,
): Promise<{ blocked: boolean; error?: string }> {
  const result = await postInvoiceApi(
    "/B2CInvoice/GetCompanyNameByTaxID",
    { UnifiedBusinessNo: taxId },
    checkCompanySchema,
  );

  if (result.ok) return { blocked: false };

  // 只有官方明訂的檢查碼驗證失敗才擋下；其他失敗（含查無資料、上游逾時）
  // 一律放行，交給後續開立流程處理——阻擋過度會誤傷合法統編。
  if (result.rtnCode === 1200125) {
    return { blocked: true, error: "統一編號格式錯誤，請確認後重新輸入" };
  }
  return { blocked: false };
}

// 手機條碼驗證：/ 開頭共 8 碼。RtnCode=1 才看 IsExist；RtnCode≠1（含財政部
// 維護中的 9000001）視為「無法驗證」，同上不阻擋——僅作輔助檢查用（官方原文）。
const checkBarcodeSchema = z.object({
  RtnCode: z.number(),
  RtnMsg: z.string(),
  IsExist: z.enum(["Y", "N"]).optional(),
});

export async function checkBarcode(
  barcode: string,
): Promise<{ blocked: boolean; error?: string }> {
  const result = await postInvoiceApi(
    "/B2CInvoice/CheckBarcode",
    { BarCode: barcode },
    checkBarcodeSchema,
  );

  if (!result.ok) return { blocked: false };
  if (result.data.IsExist === "N") {
    return { blocked: true, error: "手機條碼格式正確但查無歸戶紀錄，請確認後重新輸入" };
  }
  return { blocked: false };
}
