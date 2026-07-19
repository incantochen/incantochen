import { vi, describe, it, expect } from "vitest";

// route 現經 merchant-trade-no.ts 拉進 server-only（T96）——node 測試環境會 throw
// client-component 錯誤，比照 notify route.test.ts 以空模組 mock 掉。
vi.mock("server-only", () => ({}));

import { POST } from "../route";

// order_no 格式 INC-YYYYMMDD-XXXXXX（3+8+6=17 碼去 hyphen）
// MerchantTradeNo = 17 碼 + 2 碼隨機尾碼（T53）= 19 碼
const MERCHANT_TRADE_NO = "INC20260702ABC123XY"; // 17 碼 "INC20260702ABC123" + 2 碼尾碼 "XY"

function buildRequest(fields: Record<string, string>): Request {
  const form = new URLSearchParams(fields);
  return new Request("http://localhost/api/ecpay/order-result", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

describe("order-result route", () => {
  it("RtnCode=1 → 導向 /checkout/success，訂單號不含 2 碼隨機尾碼", async () => {
    const res = await POST(
      buildRequest({ MerchantTradeNo: MERCHANT_TRADE_NO, RtnCode: "1" }),
    );
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/checkout/success?order=INC-20260702-ABC123");
    expect(location).not.toContain("XY");
  });

  it("RtnCode≠1 → 導向 /checkout/failed，訂單號不含 2 碼隨機尾碼", async () => {
    const res = await POST(
      buildRequest({ MerchantTradeNo: MERCHANT_TRADE_NO, RtnCode: "10100252" }),
    );
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/checkout/failed?order=INC-20260702-ABC123");
    expect(location).not.toContain("XY");
  });

  it("缺 MerchantTradeNo → 導向 /checkout", async () => {
    const res = await POST(buildRequest({ RtnCode: "1" }));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/checkout");
    expect(location).not.toContain("/checkout/success");
    expect(location).not.toContain("/checkout/failed");
  });
});
