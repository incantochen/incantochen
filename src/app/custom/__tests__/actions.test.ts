/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("@/lib/get-client-ip", () => ({ getClientIp: () => "203.0.113.1" }));

const state = {
  rateLimitSuccess: true,
  insertError: null as { message: string } | null,
};
const rateLimitCalls: Array<[string | null, string]> = [];
vi.mock("@/lib/rate-limit", () => ({
  checkCustomInquiryRateLimit: async (ip: string | null, email: string) => {
    rateLimitCalls.push([ip, email]);
    return state.rateLimitSuccess;
  },
}));

const sendNotification = vi.fn().mockResolvedValue(undefined);
const sendConfirmation = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email/custom-inquiry-notification", () => ({
  sendCustomInquiryNotification: (...a: unknown[]) => sendNotification(...a),
  sendCustomInquiryConfirmation: (...a: unknown[]) => sendConfirmation(...a),
}));

type Recorded = { table: string; op: string; values?: any };
const recorded: Recorded[] = [];
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const chain: any = {
        insert: (values: any) => {
          recorded.push({ table, op: "insert", values });
          return chain;
        },
        select: () => chain,
        single: async () =>
          state.insertError
            ? { data: null, error: state.insertError }
            : { data: { id: "ci-1" }, error: null },
      };
      return chain;
    },
  }),
}));

import { createCustomInquiry } from "../actions";

const VALID = {
  category: "ring" as const,
  budgetBand: "3-5" as const,
  idea: "想要一顆祖母綠、日常好戴的戒指",
  email: "Alice@Example.com",
  phone: "0912345678",
  preferredTime: "平日晚上",
};

beforeEach(() => {
  recorded.length = 0;
  rateLimitCalls.length = 0;
  sendNotification.mockClear();
  sendConfirmation.mockClear();
  state.rateLimitSuccess = true;
  state.insertError = null;
});

describe("createCustomInquiry", () => {
  it("正常路徑：insert 一筆＋email 正規化＋寄兩封信", async () => {
    const result = await createCustomInquiry(VALID);

    expect(result).toEqual({ ok: true });
    // email 於 action 層 toLowerCase 後寫入與限流
    expect(rateLimitCalls).toEqual([["203.0.113.1", "alice@example.com"]]);
    const insert = recorded.find((r) => r.op === "insert");
    expect(insert?.values).toMatchObject({
      category: "ring",
      budget_band: "3-5",
      email: "alice@example.com",
      phone: "0912345678",
      preferred_time: "平日晚上",
    });
    expect(sendNotification).toHaveBeenCalledWith("ci-1");
    expect(sendConfirmation).toHaveBeenCalledWith("ci-1");
  });

  it("honeypot 命中 → 靜默丟棄：回 ok 但不打 DB、不寄信", async () => {
    const result = await createCustomInquiry({ ...VALID, website: "http://x" });

    expect(result).toEqual({ ok: true });
    expect(recorded).toHaveLength(0);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(sendConfirmation).not.toHaveBeenCalled();
  });

  it("驗證失敗 → 回錯、不打 DB", async () => {
    const result = await createCustomInquiry({ ...VALID, email: "bad" });

    expect(result.ok).toBe(false);
    expect(recorded).toHaveLength(0);
  });

  it("限流未通過 → 擋下且不打 DB", async () => {
    state.rateLimitSuccess = false;

    const result = await createCustomInquiry(VALID);

    expect(result).toEqual({ ok: false, error: "操作過於頻繁，請稍後再試" });
    expect(recorded).toHaveLength(0);
  });

  it("insert {error} → 回送出失敗、不寄信（§6）", async () => {
    state.insertError = { message: "connection timeout" };

    const result = await createCustomInquiry(VALID);

    expect(result).toEqual({ ok: false, error: "送出失敗，請稍後再試" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("寄信 throw → 仍回 ok（DB 已有紀錄，信失敗不擋送出）", async () => {
    sendNotification.mockRejectedValueOnce(new Error("resend down"));

    const result = await createCustomInquiry(VALID);

    expect(result).toEqual({ ok: true });
    // 通知信 throw 不影響確認信仍被嘗試
    expect(sendConfirmation).toHaveBeenCalledWith("ci-1");
  });
});
