/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { findPaidPayment } from "../find-paid-payment";

// 鎖住查詢形狀：漏掉 .eq("status","paid") 或查錯 order_id 是金流級回歸——把
// pending 誤當 paid＝取消守衛擋錯／webhook 冪等短路失效。計數測不出來，斷言引數。
let captured: { filters: Record<string, unknown> };
let result: { data: unknown; error: unknown };

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table !== "payment") throw new Error(`unexpected table ${table}`);
      const filters: Record<string, unknown> = {};
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        },
        maybeSingle: () => {
          captured = { filters };
          return Promise.resolve(result);
        },
      };
      return chain;
    },
  };
}

beforeEach(() => {
  captured = { filters: {} };
  result = { data: null, error: null };
});

describe("findPaidPayment", () => {
  it("以 order_id 為範圍、只認 status='paid'（金流級查詢形狀）", async () => {
    result = { data: { id: "pay-1" }, error: null };

    const found = await findPaidPayment(makeServiceRole() as any, "order-1");

    expect(found).toEqual({ id: "pay-1" });
    expect(captured.filters).toEqual({ order_id: "order-1", status: "paid" });
  });

  it("查無 paid payment → 回 null", async () => {
    result = { data: null, error: null };
    const found = await findPaidPayment(makeServiceRole() as any, "order-1");
    expect(found).toBeNull();
  });

  it("查詢回 { error }（DB 暫時故障，不 throw）→ 必須 throw（查詢失敗 ≠ 查無資料）", async () => {
    result = { data: null, error: { message: "connection timeout" } };

    await expect(
      findPaidPayment(makeServiceRole() as any, "order-1"),
    ).rejects.toThrow(/findPaidPayment failed/);
  });
});
