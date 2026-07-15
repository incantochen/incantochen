import { vi, describe, it, expect, afterEach } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", async () => ({
  serverEnv: (await import("./helpers")).TEST_SERVER_ENV,
}));

import { encryptedResponse } from "./helpers";
import { postInvoiceApi } from "../invoice-client";

const anySchema = z.object({ RtnCode: z.number(), RtnMsg: z.string() });
const issueSchema = anySchema.extend({ InvoiceNo: z.string() });

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("postInvoiceApi — 雙層錯誤檢查", () => {
  it("TransCode=1 且 RtnCode=1 → 成功回傳解密後的 data", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          encryptedResponse({
            RtnCode: 1,
            RtnMsg: "成功",
            InvoiceNo: "AB12345678",
          }),
        ),
        { status: 200 },
      ),
    );

    const result = await postInvoiceApi("/B2CInvoice/Issue", { Foo: "bar" }, issueSchema);
    expect(result).toEqual({
      ok: true,
      data: { RtnCode: 1, RtnMsg: "成功", InvoiceNo: "AB12345678" },
    });
  });

  it("TransCode≠1（傳輸層失敗）→ 不嘗試解密，直接回失敗", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(encryptedResponse({}, 0)), { status: 200 }),
      );

    const result = await postInvoiceApi("/B2CInvoice/Issue", {}, anySchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("傳輸失敗");
  });

  it("TransCode=1 但 RtnCode≠1（業務層失敗）→ 回失敗並帶 rtnCode", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          encryptedResponse({ RtnCode: 1200125, RtnMsg: "統編錯誤" }),
        ),
        { status: 200 },
      ),
    );

    const result = await postInvoiceApi("/B2CInvoice/Issue", {}, anySchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("統編錯誤");
      expect(result.rtnCode).toBe(1200125);
    }
  });

  it("回應形狀不符 zod schema → 回失敗（不 as-cast 硬吃）", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        // RtnCode 缺席（外部資料形狀走鐘）
        JSON.stringify(encryptedResponse({ RtnMsg: "" })),
        { status: 200 },
      ),
    );

    const result = await postInvoiceApi("/B2CInvoice/Issue", {}, anySchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("形狀不符");
  });

  it("HTTP 非 200 → 回失敗", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 500 }));

    const result = await postInvoiceApi("/B2CInvoice/Issue", {}, anySchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("500");
  });

  it("fetch 拋出例外（網路錯誤）→ 回失敗，不往外拋", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await postInvoiceApi("/B2CInvoice/Issue", {}, anySchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("network down");
  });

  it("fetch 帶有 timeout signal（掛住的請求不會無上限等待）", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(encryptedResponse({ RtnCode: 1, RtnMsg: "" })),
        { status: 200 },
      ),
    );

    await postInvoiceApi("/B2CInvoice/Issue", {}, anySchema);
    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("回應非合法 JSON → 回失敗", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("not json", { status: 200 }));

    const result = await postInvoiceApi("/B2CInvoice/Issue", {}, anySchema);
    expect(result.ok).toBe(false);
  });

  it("Data 解密失敗（非合法 base64/密文）→ 回失敗", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          MerchantID: "2000132",
          TransCode: 1,
          TransMsg: "",
          Data: "not-valid-base64-ciphertext!!!",
        }),
        { status: 200 },
      ),
    );

    const result = await postInvoiceApi("/B2CInvoice/Issue", {}, anySchema);
    expect(result.ok).toBe(false);
  });

  it("加密層同步拋錯（env 金鑰長度錯誤）→ 結構化回傳，不 throw", async () => {
    // 直接以壞 key 觸發 createCipheriv throw 的等價情境：改 mock env 不可行
    //（模組已載入），改為驗證「函式對任何內部同步例外都不外拋」的契約——
    // 用會讓 JSON.stringify 拋錯的循環結構觸發 encrypt 前置的同步例外
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    global.fetch = vi.fn();

    const result = await postInvoiceApi("/B2CInvoice/Issue", circular, anySchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("加密失敗");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("請求 body 帶入發票專用 MerchantID（非金流帳號）", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(encryptedResponse({ RtnCode: 1, RtnMsg: "" })),
        { status: 200 },
      ),
    );

    await postInvoiceApi("/B2CInvoice/Issue", {}, anySchema);
    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    const body = JSON.parse(options.body);
    expect(body.MerchantID).toBe("2000132");
  });
});
