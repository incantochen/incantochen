import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: { ORDER_ACCESS_TOKEN_SECRET: "test-secret-do-not-use-in-prod" },
}));

import {
  ORDER_ACCESS_COOKIE,
  isValidOrderAccessCookie,
  orderAccessCookieOptions,
} from "../order-access-token";

describe("isValidOrderAccessCookie", () => {
  it("cookie 對應該筆 order_no 的簽章 → 通過", () => {
    const orderNo = "INC-20260714-ABC234";
    const { value } = orderAccessCookieOptions(orderNo);
    expect(isValidOrderAccessCookie(value, orderNo)).toBe(true);
  });

  it("cookie 是別筆 order_no 的簽章 → 不通過", () => {
    const cookieForOtherOrder = orderAccessCookieOptions(
      "INC-20260714-OTHER1",
    ).value;
    expect(
      isValidOrderAccessCookie(cookieForOtherOrder, "INC-20260714-ABC234"),
    ).toBe(false);
  });

  it("cookie 缺席 → 不通過", () => {
    expect(isValidOrderAccessCookie(undefined, "INC-20260714-ABC234")).toBe(
      false,
    );
  });

  it("cookie 長度與正確簽章不同 → 不通過（不 throw）", () => {
    expect(isValidOrderAccessCookie("too-short", "INC-20260714-ABC234")).toBe(
      false,
    );
  });
});

describe("orderAccessCookieOptions", () => {
  it("回傳 httpOnly、path 限定 /checkout 的 cookie 設定", () => {
    const options = orderAccessCookieOptions("INC-20260714-ABC234");
    expect(options.name).toBe(ORDER_ACCESS_COOKIE);
    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe("/checkout");
    expect(options.sameSite).toBe("lax");
    expect(options.maxAge).toBe(60 * 60 * 2);
  });
});
