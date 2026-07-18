// T81：登入成功後接線 mergeGuestCartOnLogin——fail-soft，併車即使 throw 也不能
// 讓 verifyOtpCode 的 ok:true 退化成失敗。
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      verifyOtp: (...a: unknown[]) => verifyOtp(...a),
      signInWithOtp: async () => ({ error: null }),
    },
  }),
}));

const findOrCreateMember = vi.fn();
vi.mock("@/lib/auth/find-or-create-member", () => ({
  findOrCreateMember: (...a: unknown[]) => findOrCreateMember(...a),
}));

const mergeGuestCartOnLogin = vi.fn();
vi.mock("@/lib/cart/merge-guest-cart", () => ({
  mergeGuestCartOnLogin: (...a: unknown[]) => mergeGuestCartOnLogin(...a),
}));

// 限流一律放行（IP 為 null 時 verifyOtpCode 會跳過）。
vi.mock("@/lib/rate-limit", () => ({
  otpEmailRatelimit: { limit: async () => ({ success: true }) },
  otpIpRatelimit: { limit: async () => ({ success: true }) },
  otpVerifyIpRatelimit: { limit: async () => ({ success: true }) },
}));

import { verifyOtpCode } from "../actions";

beforeEach(() => {
  verifyOtp.mockReset();
  findOrCreateMember.mockClear();
  findOrCreateMember.mockResolvedValue(undefined);
  mergeGuestCartOnLogin.mockReset();
  mergeGuestCartOnLogin.mockResolvedValue(undefined);
});

describe("verifyOtpCode → mergeGuestCartOnLogin 接線（T81）", () => {
  it("驗證成功 → 呼叫 mergeGuestCartOnLogin(user.id)、回 ok:true", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: { id: "mem-1", email: "m@x.com" } },
      error: null,
    });

    const r = await verifyOtpCode("m@x.com", "12345678");

    expect(r).toEqual({ ok: true });
    expect(mergeGuestCartOnLogin).toHaveBeenCalledWith("mem-1");
  });

  it("併車 throw → 不影響 ok:true（fail-soft）", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: { id: "mem-1", email: "m@x.com" } },
      error: null,
    });
    // mergeGuestCartOnLogin 內部本應吞錯；即便它意外 throw，也不能讓登入失敗。
    // 註：現行實作 merge 為 fail-soft 不 throw；這裡直接注入 throw 是回歸鎖，
    // 確保未來即使 merge 契約改變，登入主流程仍不被它拖垮。
    mergeGuestCartOnLogin.mockRejectedValue(new Error("merge boom"));

    const r = await verifyOtpCode("m@x.com", "12345678").catch((e) => ({
      threw: e,
    }));

    expect(r).toEqual({ ok: true });
  });

  it("OTP 驗證失敗 → 不呼叫 mergeGuestCartOnLogin", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "bad" },
    });

    const r = await verifyOtpCode("m@x.com", "12345678");

    expect(r).toEqual({ ok: false, error: "驗證碼錯誤或已過期" });
    expect(mergeGuestCartOnLogin).not.toHaveBeenCalled();
  });
});
