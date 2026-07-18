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

  // 註（T81 max review #9）：「併車 throw 不影響登入」的回歸鎖已移至
  // merge-guest-cart.test.ts ⑫——fail-soft 現在是 mergeGuestCartOnLogin 的
  // 結構保證（try 包住整個函式體），call-site 不再各自包 try/catch，故本檔
  // 不再注入 throw 測 call-site 兜底（那個兜底已按設計移除）。

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
