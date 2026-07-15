import "server-only";
import type { z } from "zod";
import {
  encryptEcpayPayload,
  decryptEcpayPayload,
  ecpayTimestampSeconds,
} from "@/lib/ecpay/aes-payload";
import { serverEnv } from "@/lib/env.server";

// ECPay B2C 發票 API 通用 request/response 外層結構（AES-JSON，Revision 3.0.0）。
// 官方規格（7896）：外層明文只有 MerchantID／RqHeader.Timestamp／Data。

// 呼叫端在 webhook 熱路徑上（notify route 的 after() 回呼），逾時上限給
// 明確值：ECPay 正常回應在數秒內，掛住的請求不該無上限等下去佔住 function 時間
const INVOICE_API_TIMEOUT_MS = 15_000;

type EcpayInvoiceResponse = {
  TransCode: number;
  TransMsg: string;
  Data: string;
};

export type InvoiceApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; rtnCode?: number };

// 雙層錯誤檢查（藍圖 04-security.md §2.1，缺一不可）：
// ① 外層 TransCode===1（傳輸層，整數）
// ② AES 解密→urldecode→JSON parse→zod 驗形（外部資料不可 as-cast 了事）
// ③ 內層 RtnCode===1（業務層，整數——非 CMV 家族的字串 "1"）
// 本函式**絕不 throw**：包含同步的加密失敗（env 金鑰長度錯誤時 createCipheriv
// 會拋）——任何例外都轉成結構化回傳，呼叫端（最終是金流 webhook）依賴這個契約。
export async function postInvoiceApi<
  T extends { RtnCode: number; RtnMsg: string },
>(
  path: string,
  data: Record<string, unknown>,
  responseSchema: z.ZodType<T>,
): Promise<InvoiceApiResult<T>> {
  let encryptedData: string;
  try {
    encryptedData = encryptEcpayPayload(
      { ...data, MerchantID: serverEnv.ECPAY_INVOICE_MERCHANT_ID },
      serverEnv.ECPAY_INVOICE_HASH_KEY,
      serverEnv.ECPAY_INVOICE_HASH_IV,
    );
  } catch (e) {
    // 多半是 HashKey/HashIV 長度非 16 bytes 的 env 誤設——這種錯每一筆都會
    // 發生，訊息講清楚指向設定而非資料
    return {
      ok: false,
      error: `發票資料加密失敗（請檢查 ECPAY_INVOICE_HASH_KEY/IV 設定）：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const requestBody = {
    MerchantID: serverEnv.ECPAY_INVOICE_MERCHANT_ID,
    RqHeader: { Timestamp: ecpayTimestampSeconds() },
    Data: encryptedData,
  };

  let response: Response;
  try {
    response = await fetch(`${serverEnv.ECPAY_INVOICE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(INVOICE_API_TIMEOUT_MS),
    });
  } catch (e) {
    return {
      ok: false,
      error: `發票 API 連線失敗：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!response.ok) {
    return { ok: false, error: `發票 API HTTP ${response.status}` };
  }

  let outer: EcpayInvoiceResponse;
  try {
    outer = (await response.json()) as EcpayInvoiceResponse;
  } catch {
    return { ok: false, error: "發票 API 回應格式錯誤（非 JSON）" };
  }

  // ① 傳輸層檢查——型別是整數，禁止用字串 "1" 比對（那是 CMV 家族的慣例）
  if (Number(outer.TransCode) !== 1) {
    return {
      ok: false,
      error: `發票 API 傳輸失敗：${outer.TransMsg || "未知錯誤"}`,
    };
  }

  let decrypted: unknown;
  try {
    decrypted = decryptEcpayPayload(
      outer.Data,
      serverEnv.ECPAY_INVOICE_HASH_KEY,
      serverEnv.ECPAY_INVOICE_HASH_IV,
    );
  } catch (e) {
    return {
      ok: false,
      error: `發票 API 回應解密失敗：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // 外部資料先 zod 驗形（專案慣例：RPC/外部 payload 不信任形狀），
  // 驗不過視為協議層錯誤——好過 as-cast 後在深處讀到 undefined
  const parsed = responseSchema.safeParse(decrypted);
  if (!parsed.success) {
    return {
      ok: false,
      error: `發票 API 回應形狀不符：${parsed.error.issues[0]?.message ?? "unknown"}`,
    };
  }
  const inner = parsed.data;

  // ② 業務層檢查——同樣是整數
  if (Number(inner.RtnCode) !== 1) {
    return {
      ok: false,
      error: inner.RtnMsg || "發票 API 業務邏輯失敗",
      rtnCode: inner.RtnCode,
    };
  }

  return { ok: true, data: inner };
}
