import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", async () => ({
  serverEnv: (await import("./helpers")).TEST_SERVER_ENV,
}));

import { encryptedResponse } from "./helpers";
import { checkCompanyIdentifier, checkBarcode } from "../validate";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("checkCompanyIdentifier", () => {
  it("RtnCode=1200125（檢查碼驗證失敗）→ blocked=true", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          encryptedResponse({ RtnCode: 1200125, RtnMsg: "統一編號檢查碼驗證失敗" }),
        ),
        { status: 200 },
      ),
    );

    const result = await checkCompanyIdentifier("12345678");
    expect(result.blocked).toBe(true);
  });

  it("RtnCode=1200125 且 CompanyName:null（真實 API 回應形狀）→ 仍 blocked=true，不因 null 欄位 fail-open", async () => {
    // 迴歸測試：真實 stage API 對無效統編回 CompanyName:null；schema 若在
    // 讀 RtnCode 前先驗完整形狀，null 會讓解析失敗、遺失 rtnCode，把明確
    // 拒絕降級成「API 故障」放行（實測 12345678 曾因此建單、開立時才爆）
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          encryptedResponse({
            RtnCode: 1200125,
            RtnMsg: "統一編號檢查碼驗證失敗，請再確認",
            CompanyName: null,
          }),
        ),
        { status: 200 },
      ),
    );

    const result = await checkCompanyIdentifier("12345678");
    expect(result.blocked).toBe(true);
  });

  it("RtnCode=7（查無資料）→ 官方明訂不代表無效，blocked=false", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(encryptedResponse({ RtnCode: 7, RtnMsg: "查無資料" })),
        { status: 200 },
      ),
    );

    const result = await checkCompanyIdentifier("12345678");
    expect(result.blocked).toBe(false);
  });

  it("RtnCode=9000001（財政部 API 失敗）→ 不阻擋，blocked=false", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(encryptedResponse({ RtnCode: 9000001, RtnMsg: "上游逾時" })),
        { status: 200 },
      ),
    );

    const result = await checkCompanyIdentifier("12345678");
    expect(result.blocked).toBe(false);
  });

  it("RtnCode=1（成功）→ blocked=false", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          encryptedResponse({ RtnCode: 1, RtnMsg: "成功", CompanyName: "測試公司" }),
        ),
        { status: 200 },
      ),
    );

    const result = await checkCompanyIdentifier("12345678");
    expect(result.blocked).toBe(false);
  });

  it("API 完全連不上（HTTP 失敗）→ 不阻擋，優雅降級", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 500 }));

    const result = await checkCompanyIdentifier("12345678");
    expect(result.blocked).toBe(false);
  });
});

describe("checkBarcode", () => {
  it("IsExist=Y → blocked=false", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          encryptedResponse({ RtnCode: 1, RtnMsg: "", IsExist: "Y" }),
        ),
        { status: 200 },
      ),
    );

    const result = await checkBarcode("/ABC1234");
    expect(result.blocked).toBe(false);
  });

  it("IsExist=N（查無歸戶）→ blocked=true", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          encryptedResponse({ RtnCode: 1, RtnMsg: "", IsExist: "N" }),
        ),
        { status: 200 },
      ),
    );

    const result = await checkBarcode("/ABC1234");
    expect(result.blocked).toBe(true);
  });

  it("API 失敗（RtnCode≠1）→ 不阻擋", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(encryptedResponse({ RtnCode: 9000001, RtnMsg: "" })),
        { status: 200 },
      ),
    );

    const result = await checkBarcode("/ABC1234");
    expect(result.blocked).toBe(false);
  });
});
