/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// 登入使用者固定；requireUser 未登入會 redirect，該行為在 require-user 自身覆蓋
const USER_ID = "22222222-2222-4222-8222-222222222222";
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: USER_ID, email: "member@example.com" }),
}));

// T93 限流 mock：預設放行，個別測試覆寫
const state = {
  rateLimitSuccess: true,
  order: {
    id: "33333333-3333-4333-8333-333333333333",
    member_id: USER_ID,
    status: "paid",
  } as { id: string; member_id: string; status: string } | null,
  orderError: null as { message: string } | null,
  existingRequests: [] as Array<{ id: string }>,
  existingError: null as { message: string } | null,
  insertError: null as { message: string } | null,
};
const rateLimitCalls: string[] = [];
vi.mock("@/lib/rate-limit", () => ({
  checkSupportRequestRateLimit: async (memberId: string) => {
    rateLimitCalls.push(memberId);
    return state.rateLimitSuccess;
  },
}));

const sendSupportRequestNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email/support-request-notification", () => ({
  sendSupportRequestNotification: (...a: unknown[]) =>
    sendSupportRequestNotification(...a),
}));

type Recorded = { table: string; op: string; values?: any; filters: any[] };
const recorded: Recorded[] = [];

function makeServiceRole() {
  return {
    from: (table: string) => {
      const filters: any[] = [];
      const chain: any = {
        select: () => chain,
        insert: (values: any) => {
          recorded.push({ table, op: "insert", values, filters });
          return chain;
        },
        eq: (col: string, val: any) => {
          filters.push({ eq: [col, val] });
          return chain;
        },
        in: (col: string, val: any) => {
          filters.push({ in: [col, val] });
          return chain;
        },
        limit: () => chain,
        maybeSingle: async () =>
          table === "orders"
            ? { data: state.order, error: state.orderError }
            : { data: null, error: null },
        single: async () =>
          state.insertError
            ? { data: null, error: state.insertError }
            : { data: { id: "sr-1" }, error: null },
        then: (resolve: (v: any) => void) => {
          // await chain（select…in…limit 的去重查詢）走這裡
          resolve({ data: state.existingRequests, error: state.existingError });
        },
      };
      return chain;
    },
  };
}
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => makeServiceRole(),
}));

import { createSupportRequest } from "../actions";

const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const VALID_DESC = { description: "寶石鑲座鬆動，配戴一次後主石搖晃。" };

beforeEach(() => {
  recorded.length = 0;
  rateLimitCalls.length = 0;
  sendSupportRequestNotification.mockClear();
  state.rateLimitSuccess = true;
  state.order = { id: ORDER_ID, member_id: USER_ID, status: "paid" };
  state.orderError = null;
  state.existingRequests = [];
  state.existingError = null;
  state.insertError = null;
});

describe("createSupportRequest（T93 限流＋同單去重）", () => {
  it("正常路徑：insert 一筆 return_defect 並寄通知", async () => {
    const result = await createSupportRequest(ORDER_ID, VALID_DESC);

    expect(result).toEqual({ ok: true });
    expect(rateLimitCalls).toEqual([USER_ID]);
    const insert = recorded.find((r) => r.table === "support_request");
    expect(insert?.values).toMatchObject({
      order_id: ORDER_ID,
      member_id: USER_ID,
      request_type: "return_defect",
    });
    expect(sendSupportRequestNotification).toHaveBeenCalledWith("sr-1");
  });

  it("限流未通過 → 擋下且不打任何 DB 查詢", async () => {
    state.rateLimitSuccess = false;

    const result = await createSupportRequest(ORDER_ID, VALID_DESC);

    expect(result).toEqual({
      ok: false,
      error: "操作過於頻繁，請稍後再試",
    });
    expect(recorded).toHaveLength(0);
  });

  it("同單已有處理中案件 → 拒新增、不 insert", async () => {
    state.existingRequests = [{ id: "sr-existing" }];

    const result = await createSupportRequest(ORDER_ID, VALID_DESC);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("已有處理中的申請");
    expect(recorded.filter((r) => r.op === "insert")).toHaveLength(0);
  });

  it("去重查詢 {error} → 回系統忙碌，不誤放行 insert（§6）", async () => {
    state.existingError = { message: "connection timeout" };

    const result = await createSupportRequest(ORDER_ID, VALID_DESC);

    expect(result).toEqual({ ok: false, error: "系統忙碌，請稍後再試" });
    expect(recorded.filter((r) => r.op === "insert")).toHaveLength(0);
  });

  it("訂單查詢 {error} → 回系統忙碌而非「找不到訂單」（§6）", async () => {
    state.orderError = { message: "connection timeout" };

    const result = await createSupportRequest(ORDER_ID, VALID_DESC);

    expect(result).toEqual({ ok: false, error: "系統忙碌，請稍後再試" });
  });

  it("非本人訂單 → 找不到訂單", async () => {
    state.order = { id: ORDER_ID, member_id: "someone-else", status: "paid" };

    const result = await createSupportRequest(ORDER_ID, VALID_DESC);

    expect(result).toEqual({ ok: false, error: "找不到訂單" });
  });
});
