import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    ECPAY_MERCHANT_ID: "3002607",
    ECPAY_HASH_KEY: "test-hash-key",
    ECPAY_HASH_IV: "test-hash-iv",
    ECPAY_PAYMENT_URL: "https://payment-stage.example/Cashier/AioCheckOut/V5",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    UPSTASH_REDIS_REST_URL: "http://localhost",
    UPSTASH_REDIS_REST_TOKEN: "test",
    RESEND_API_KEY: "test",
    ADMIN_EMAIL: "admin@example.com",
    CRON_SECRET: "test-cron-secret",
  },
}));

import { generateCheckMacValue } from "@/lib/ecpay/check-mac-value";
import {
  buildQueryTradeParams,
  queryTradeInfo,
  RateLimitError,
} from "@/lib/ecpay/query-trade-info";

const HASH_KEY = "test-hash-key";
const HASH_IV = "test-hash-iv";

function signedResponseBody(params: Record<string, string>): string {
  const body = { ...params };
  body.CheckMacValue = generateCheckMacValue(body, HASH_KEY, HASH_IV);
  return new URLSearchParams(body).toString();
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("buildQueryTradeParams", () => {
  it("含新鮮 Unix TimeStamp 與可驗證的 CheckMacValue", () => {
    const before = Math.floor(Date.now() / 1000);
    const params = buildQueryTradeParams("INC20260702ABC123XY");
    const after = Math.floor(Date.now() / 1000);

    expect(params.MerchantID).toBe("3002607");
    expect(params.MerchantTradeNo).toBe("INC20260702ABC123XY");
    const ts = Number(params.TimeStamp);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);

    const expected = generateCheckMacValue(
      { ...params, CheckMacValue: undefined as unknown as string },
      HASH_KEY,
      HASH_IV,
    );
    // generateCheckMacValue 內部本來就會濾掉 CheckMacValue 欄位，這裡直接
    // 用同一份 params（含 CheckMacValue）重算一次，兩者應相同。
    expect(generateCheckMacValue(params, HASH_KEY, HASH_IV)).toBe(
      params.CheckMacValue,
    );
    expect(expected).toBe(params.CheckMacValue);
  });
});

describe("queryTradeInfo", () => {
  it("成功：解析 URL-encoded 回應、驗章通過、回傳 tradeStatus/tradeAmt/tradeNo", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        signedResponseBody({
          MerchantID: "3002607",
          MerchantTradeNo: "INC20260702ABC123XY",
          TradeNo: "2607021234567890",
          TradeAmt: "25000",
          TradeStatus: "1",
        }),
        { status: 200 },
      ),
    );

    const result = await queryTradeInfo("INC20260702ABC123XY");

    expect(result.tradeStatus).toBe("1");
    expect(result.tradeAmt).toBe(25000);
    expect(result.tradeNo).toBe("2607021234567890");
  });

  it("回應 CheckMacValue 錯誤 → throw（防止偽造對帳結果）", async () => {
    const body = new URLSearchParams({
      MerchantID: "3002607",
      MerchantTradeNo: "INC20260702ABC123XY",
      TradeStatus: "1",
      TradeAmt: "25000",
      CheckMacValue: "0".repeat(64),
    }).toString();
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 200 }));

    await expect(queryTradeInfo("INC20260702ABC123XY")).rejects.toThrow(
      /CheckMacValue/,
    );
  });

  it("非 200 回應 → 拋出 RateLimitError（呼叫端據此中止批次）", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 403 }));

    await expect(queryTradeInfo("INC20260702ABC123XY")).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("TradeAmt 非數字格式 → tradeAmt 回傳 NaN，不誤判為金額相符", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        signedResponseBody({
          MerchantID: "3002607",
          MerchantTradeNo: "INC20260702ABC123XY",
          TradeStatus: "1",
          TradeAmt: "",
        }),
        { status: 200 },
      ),
    );

    const result = await queryTradeInfo("INC20260702ABC123XY");
    expect(Number.isNaN(result.tradeAmt)).toBe(true);
  });
});
