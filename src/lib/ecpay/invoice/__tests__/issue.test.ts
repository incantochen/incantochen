import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", async () => ({
  serverEnv: (await import("./helpers")).TEST_SERVER_ENV,
}));

import {
  encryptedResponse,
  INVOICE_HASH_KEY,
  INVOICE_HASH_IV,
} from "./helpers";
import { decryptEcpayPayload } from "@/lib/ecpay/aes-payload";
import { callIssue, getIssueByRelateNumber } from "../issue";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function decryptRequestData(fetchMock: ReturnType<typeof vi.fn>) {
  const [, options] = fetchMock.mock.calls[0];
  const body = JSON.parse(options.body);
  return decryptEcpayPayload(
    body.Data,
    INVOICE_HASH_KEY,
    INVOICE_HASH_IV,
  ) as Record<string, unknown>;
}

function issueSuccessResponse(invoiceNo = "AB11111111") {
  return new Response(
    JSON.stringify(
      encryptedResponse({
        RtnCode: 1,
        RtnMsg: "",
        InvoiceNo: invoiceNo,
        InvoiceDate: "2026-07-14 12:00:00",
        RandomNumber: "1234",
      }),
    ),
    { status: 200 },
  );
}

const BASE_PARAMS = {
  relateNumber: "INVTEST123",
  customerName: "王小明",
  customerAddr: "台北市大安區測試路 1 號",
  customerPhone: "0912345678",
  customerEmail: "test@example.com",
  totalAmount: 25000,
  items: [{ name: "祖母綠戒指", quantity: 1, unitPrice: 25000 }],
};

describe("callIssue — 金額防呆", () => {
  it("items 加總與 totalAmount 不符時直接擋下，不打 API", async () => {
    global.fetch = vi.fn();
    const result = await callIssue({
      ...BASE_PARAMS,
      target: { kind: "personal" },
      totalAmount: 99999,
    });
    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("callIssue — 發票去向欄位組裝（官方 Print×CarrierType 互斥規則）", () => {
  it("personal → CarrierType=1＋Print=0，不含統編/CustomerAddr", async () => {
    global.fetch = vi.fn().mockResolvedValue(issueSuccessResponse());

    const result = await callIssue({
      ...BASE_PARAMS,
      target: { kind: "personal" },
    });
    expect(result.ok).toBe(true);

    const decrypted = decryptRequestData(global.fetch as ReturnType<typeof vi.fn>);
    expect(decrypted.CarrierType).toBe("1");
    expect(decrypted.Print).toBe("0");
    expect(decrypted.CustomerIdentifier).toBeUndefined();
    expect(decrypted.CustomerAddr).toBeUndefined();
    expect(decrypted.CarrierNum).toBeUndefined();
  });

  it("company → Print=1＋CustomerAddr＋統編＋空載具（官方：載具空時 Print 只能 1）", async () => {
    global.fetch = vi.fn().mockResolvedValue(issueSuccessResponse());

    await callIssue({
      ...BASE_PARAMS,
      target: { kind: "company", taxId: "12345678" },
    });

    const decrypted = decryptRequestData(global.fetch as ReturnType<typeof vi.fn>);
    expect(decrypted.CustomerIdentifier).toBe("12345678");
    expect(decrypted.Print).toBe("1");
    expect(decrypted.CustomerAddr).toBe("台北市大安區測試路 1 號");
    expect(decrypted.CarrierType).toBe("");
  });

  it("mobile_barcode → CarrierType=3＋Print=0＋CarrierNum", async () => {
    global.fetch = vi.fn().mockResolvedValue(issueSuccessResponse());

    await callIssue({
      ...BASE_PARAMS,
      target: { kind: "mobile_barcode", barcode: "/ABC1234" },
    });

    const decrypted = decryptRequestData(global.fetch as ReturnType<typeof vi.fn>);
    expect(decrypted.CarrierType).toBe("3");
    expect(decrypted.Print).toBe("0");
    expect(decrypted.CarrierNum).toBe("/ABC1234");
  });

  it("customerEmail 空字串 → 不送 CustomerEmail 欄位（Phone/Email 擇一）", async () => {
    global.fetch = vi.fn().mockResolvedValue(issueSuccessResponse());

    await callIssue({
      ...BASE_PARAMS,
      customerEmail: "",
      target: { kind: "personal" },
    });

    const decrypted = decryptRequestData(global.fetch as ReturnType<typeof vi.fn>);
    expect(decrypted.CustomerEmail).toBeUndefined();
    expect(decrypted.CustomerPhone).toBe("0912345678");
  });

  it("Items 的 ItemAmount 加總等於 SalesAmount", async () => {
    global.fetch = vi.fn().mockResolvedValue(issueSuccessResponse());

    await callIssue({
      ...BASE_PARAMS,
      totalAmount: 28000,
      items: [
        { name: "祖母綠戒指", quantity: 1, unitPrice: 25000 },
        { name: "白金加價", quantity: 1, unitPrice: 3000 },
      ],
      target: { kind: "personal" },
    });

    const decrypted = decryptRequestData(
      global.fetch as ReturnType<typeof vi.fn>,
    ) as { Items: { ItemAmount: number }[]; SalesAmount: number };
    const sum = decrypted.Items.reduce((s, i) => s + i.ItemAmount, 0);
    expect(sum).toBe(decrypted.SalesAmount);
    expect(sum).toBe(28000);
  });
});

describe("getIssueByRelateNumber — 冪等判別", () => {
  it("查得到 → found:true 帶回真實發票號碼三件組", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          encryptedResponse({
            RtnCode: 1,
            RtnMsg: "",
            IIS_Number: "AB99999999",
            IIS_Create_Date: "2026-07-14 11:00:00",
            IIS_Random_Number: "5678",
          }),
        ),
        { status: 200 },
      ),
    );

    const result = await getIssueByRelateNumber("INVTEST123");
    expect(result).toEqual({
      found: true,
      invoiceNo: "AB99999999",
      invoiceDate: "2026-07-14 11:00:00",
      randomNumber: "5678",
    });
  });

  it("查無（RtnCode≠1）→ found:false", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(encryptedResponse({ RtnCode: 5000000, RtnMsg: "查無資料" })),
        { status: 200 },
      ),
    );

    const result = await getIssueByRelateNumber("INVTEST123");
    expect(result).toEqual({ found: false });
  });

  it("API 連線失敗 → found:false（呼叫端視為真正失敗，不誤判已開立）", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await getIssueByRelateNumber("INVTEST123");
    expect(result).toEqual({ found: false });
  });
});
