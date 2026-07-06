import "server-only";
import {
  generateCheckMacValue,
  verifyCheckMacValue,
} from "@/lib/ecpay/check-mac-value";
import { serverEnv } from "@/lib/env.server";

// ECPay 官方 ECPay-API-Skill 文件（docs/prompt-examples.md）確認：QueryTradeInfo/V5
// 與 AioCheckOut/V5 同網域，故由既有 ECPAY_PAYMENT_URL 推導，不新增 env var。
function buildQueryTradeInfoUrl(): string {
  return serverEnv.ECPAY_PAYMENT_URL.replace(
    "/Cashier/AioCheckOut/V5",
    "/Cashier/QueryTradeInfo/V5",
  );
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

// TimeStamp 效期僅 3 分鐘（不同於 AioCheckOut 的 MerchantTradeDate），
// 必須在每次呼叫前才產生新鮮值，不可預先建好快取。
export function buildQueryTradeParams(
  merchantTradeNo: string,
): Record<string, string> {
  const params: Record<string, string> = {
    MerchantID: serverEnv.ECPAY_MERCHANT_ID,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: String(Math.floor(Date.now() / 1000)),
  };

  params.CheckMacValue = generateCheckMacValue(
    params,
    serverEnv.ECPAY_HASH_KEY,
    serverEnv.ECPAY_HASH_IV,
  );

  return params;
}

export type QueryTradeResult = {
  tradeStatus: string;
  tradeAmt: number;
  tradeNo: string | null;
  raw: Record<string, string>;
};

export async function queryTradeInfo(
  merchantTradeNo: string,
): Promise<QueryTradeResult> {
  const params = buildQueryTradeParams(merchantTradeNo);

  const response = await fetch(buildQueryTradeInfoUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });

  // ECPay 官方文件明確警告此 API 有頻率限制、不建議高頻輪詢；非 200 視為
  // 限流訊號，由呼叫端中止本次批次，下次排程再繼續，而不是當成單筆查詢失敗略過。
  if (!response.ok) {
    throw new RateLimitError(`QueryTradeInfo 非 200 回應：${response.status}`);
  }

  const text = await response.text();
  const raw: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) raw[k] = v;

  // 驗證失敗要 throw，不可靜默當查詢失敗略過——這是防止偽造對帳結果的安全關卡。
  if (
    !verifyCheckMacValue(raw, serverEnv.ECPAY_HASH_KEY, serverEnv.ECPAY_HASH_IV)
  ) {
    throw new Error("QueryTradeInfo CheckMacValue 驗證失敗");
  }

  const tradeAmt = parseInt(raw.TradeAmt ?? "0", 10);

  return {
    tradeStatus: raw.TradeStatus ?? "",
    tradeAmt: Number.isFinite(tradeAmt) ? tradeAmt : NaN,
    tradeNo: raw.TradeNo ?? null,
    raw,
  };
}
