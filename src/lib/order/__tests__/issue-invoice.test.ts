/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const callIssue = vi.fn();
const getIssueByRelateNumber = vi.fn();
vi.mock("@/lib/ecpay/invoice/issue", () => ({
  callIssue: (...a: unknown[]) => callIssue(...a),
  getIssueByRelateNumber: (...a: unknown[]) => getIssueByRelateNumber(...a),
}));

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

type MockError = { message: string } | null;

const state = {
  order: null as any,
  orderError: null as MockError,
  paidPayment: { merchant_trade_no: "INC20260714ABCDE12" } as {
    merchant_trade_no: string;
  } | null,
  paymentError: null as MockError,
  casUpdateResult: { data: [{ id: ORDER_ID }], error: null as MockError },
  backfillError: null as MockError,
};

// orders.update 有兩條路徑：CAS 寫入（.eq id + .eq invoice_status → .select()）
// 與 CAS-miss 補填（.eq id + .is invoice_no null，直接 await）——用鏈上是否
// 呼叫過 .is() 區分
const recordedUpdates: { values: any; usedIs: boolean }[] = [];

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: state.order, error: state.orderError }),
            }),
          }),
          update: (values: any) => {
            const entry = { values, usedIs: false };
            recordedUpdates.push(entry);
            const promise = () =>
              Promise.resolve(
                entry.usedIs
                  ? { data: null, error: state.backfillError }
                  : state.casUpdateResult,
              );
            const chain: any = {
              eq: () => chain,
              is: () => {
                entry.usedIs = true;
                return chain;
              },
              select: () => promise(),
              then: (resolve: any, reject: any) =>
                promise().then(resolve, reject),
            };
            return chain;
          },
        };
      }
      // payment
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: state.paidPayment,
                      error: state.paymentError,
                    }),
                }),
              }),
            }),
          }),
        }),
      };
    },
  };
}

import { issueInvoiceForOrder } from "../issue-invoice";

function baseOrder(overrides: Partial<any> = {}) {
  return {
    id: ORDER_ID,
    status: "paid",
    invoice_no: null,
    invoice_status: "none",
    invoice_meta: null,
    total_amount: 25000,
    recipient_name: "王小明",
    recipient_phone: "0912345678",
    shipping_address: "台北市大安區測試路 1 號",
    member: { email: "buyer@example.com" },
    order_item: [
      {
        quantity: 1,
        unit_price_snapshot: 25000,
        product_name_snapshot: "祖母綠戒指",
      },
    ],
    ...overrides,
  };
}

const ISSUE_OK = {
  ok: true,
  invoiceNo: "AB12345678",
  invoiceDate: "2026-07-14 12:00:00",
  randomNumber: "4321",
};

beforeEach(() => {
  callIssue.mockReset();
  getIssueByRelateNumber.mockReset();
  recordedUpdates.length = 0;
  state.order = baseOrder();
  state.orderError = null;
  state.paidPayment = { merchant_trade_no: "INC20260714ABCDE12" };
  state.paymentError = null;
  state.casUpdateResult = { data: [{ id: ORDER_ID }], error: null };
  state.backfillError = null;
});

describe("issueInvoiceForOrder — 前置檢查", () => {
  it("訂單不存在 → 回錯誤，不呼叫 ECPay", async () => {
    state.order = null;
    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result.ok).toBe(false);
    expect(callIssue).not.toHaveBeenCalled();
  });

  it("訂單未付款 → 拒絕開立", async () => {
    state.order = baseOrder({ status: "pending_payment" });
    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("尚未付款");
    expect(callIssue).not.toHaveBeenCalled();
  });

  it("已開立 → 冪等短路，不重打 ECPay", async () => {
    state.order = baseOrder({ invoice_status: "issued", invoice_no: "AB99999999" });
    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result).toEqual({
      ok: true,
      invoiceNo: "AB99999999",
      alreadyIssued: true,
    });
    expect(callIssue).not.toHaveBeenCalled();
  });

  it("查無客戶 Email → 拒絕開立", async () => {
    state.order = baseOrder({ member: null });
    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Email");
  });

  it("查無已付款的付款記錄 → 拒絕開立", async () => {
    state.paidPayment = null;
    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("付款記錄");
  });

  it("訂單無品項 → 拒絕開立", async () => {
    state.order = baseOrder({ order_item: [] });
    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("無品項");
  });

  it("訂單總額低於品項加總（折抵）→ 明確拒絕，不呼叫 ECPay", async () => {
    state.order = baseOrder({ total_amount: 20000 });
    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("折抵");
    expect(callIssue).not.toHaveBeenCalled();
  });
});

describe("issueInvoiceForOrder — 成功路徑與欄位正規化", () => {
  it("成功開立：RelateNumber 由 merchant_trade_no 衍生，寫回三件組", async () => {
    callIssue.mockResolvedValue(ISSUE_OK);

    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result).toEqual({
      ok: true,
      invoiceNo: "AB12345678",
      alreadyIssued: false,
    });
    expect(callIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        relateNumber: "INVINC20260714ABCDE12",
        target: { kind: "personal" },
        customerEmail: "buyer@example.com",
        customerAddr: "台北市大安區測試路 1 號",
      }),
    );
    // CAS 寫入含 invoice_no 與 meta
    const cas = recordedUpdates.find((u) => !u.usedIs);
    expect(cas?.values).toMatchObject({
      invoice_no: "AB12345678",
      invoice_status: "issued",
    });
  });

  it("電話連字號正規化為純數字（ECPay CustomerPhone 限制）", async () => {
    state.order = baseOrder({ recipient_phone: "02-1234-5678" });
    callIssue.mockResolvedValue(ISSUE_OK);

    await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(callIssue).toHaveBeenCalledWith(
      expect.objectContaining({ customerPhone: "0212345678" }),
    );
  });

  it("email 超過 80 字 → 不送 email（Phone/Email 擇一）", async () => {
    const longEmail = `${"a".repeat(90)}@example.com`;
    state.order = baseOrder({ member: { email: longEmail } });
    callIssue.mockResolvedValue(ISSUE_OK);

    await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(callIssue).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmail: "" }),
    );
  });

  it("訂單總額高於品項加總（運費）→ 自動補「運費」品項讓金額相符", async () => {
    state.order = baseOrder({ total_amount: 25100 });
    callIssue.mockResolvedValue(ISSUE_OK);

    await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    const params = callIssue.mock.calls[0]![0];
    expect(params.items).toContainEqual({
      name: "運費",
      quantity: 1,
      unitPrice: 100,
    });
    expect(params.totalAmount).toBe(25100);
  });

  it("invoice_meta.target='company' → 組出 company target", async () => {
    state.order = baseOrder({
      invoice_meta: { target: "company", customer_identifier: "12345678" },
    });
    callIssue.mockResolvedValue(ISSUE_OK);

    await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(callIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "company", taxId: "12345678" },
      }),
    );
  });

  it("invoice_meta 形狀走鐘（zod 驗不過）→ fallback personal，不炸", async () => {
    state.order = baseOrder({ invoice_meta: { target: 123, junk: true } });
    callIssue.mockResolvedValue(ISSUE_OK);

    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result.ok).toBe(true);
    expect(callIssue).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "personal" } }),
    );
  });

  it("CAS 未命中（並發搶輸）→ 補填 .is(invoice_no, null) 且仍回 ok", async () => {
    callIssue.mockResolvedValue(ISSUE_OK);
    state.casUpdateResult = { data: [], error: null };

    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result.ok).toBe(true);
    const backfill = recordedUpdates.find((u) => u.usedIs);
    expect(backfill?.values).toMatchObject({ invoice_no: "AB12345678" });
  });

  it("本地寫入失敗（DB error）→ 回 ok:false 並帶號碼供人工補登", async () => {
    callIssue.mockResolvedValue(ISSUE_OK);
    state.casUpdateResult = { data: null as any, error: { message: "db down" } };

    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("AB12345678");
  });
});

describe("issueInvoiceForOrder — Issue 失敗時的 GetIssue 冪等判別", () => {
  it("Issue 失敗但 GetIssue 查得到 → 視為已開立，取回真實號碼寫入", async () => {
    callIssue.mockResolvedValue({ ok: false, error: "任何失敗訊息" });
    getIssueByRelateNumber.mockResolvedValue({
      found: true,
      invoiceNo: "AB77777777",
      invoiceDate: "2026-07-14 11:00:00",
      randomNumber: "9999",
    });

    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result).toEqual({
      ok: true,
      invoiceNo: "AB77777777",
      alreadyIssued: false,
    });
    expect(getIssueByRelateNumber).toHaveBeenCalledWith("INVINC20260714ABCDE12");
    const cas = recordedUpdates.find((u) => !u.usedIs);
    expect(cas?.values).toMatchObject({ invoice_no: "AB77777777" });
  });

  it("Issue 失敗且 GetIssue 查無 → 真正失敗，回原始錯誤", async () => {
    callIssue.mockResolvedValue({ ok: false, error: "統編格式錯誤" });
    getIssueByRelateNumber.mockResolvedValue({ found: false });

    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("統編格式錯誤");
    expect(recordedUpdates).toHaveLength(0);
  });

  it("callIssue 拋出非預期例外 → 不外拋，走 GetIssue 判別後回結構化錯誤", async () => {
    callIssue.mockRejectedValue(new Error("boom"));
    getIssueByRelateNumber.mockResolvedValue({ found: false });

    const result = await issueInvoiceForOrder(makeServiceRole() as any, ORDER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("boom");
  });
});
