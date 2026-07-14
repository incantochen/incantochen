import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: { ORDER_ACCESS_TOKEN_SECRET: "test-secret-do-not-use-in-prod" },
}));

import {
  ORDER_ACCESS_COOKIE,
  isValidOrderAccessCookie,
  orderAccessCookieOptions,
  resolveOrderOwnership,
} from "../order-access-token";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("cookie 沒有核發時間分隔符（格式不對）→ 不通過（不 throw）", () => {
    expect(isValidOrderAccessCookie("too-short", "INC-20260714-ABC234")).toBe(
      false,
    );
  });

  it("cookie 核發時間非數字（偽造）→ 不通過（不 throw NaN 比較）", () => {
    expect(
      isValidOrderAccessCookie("not-a-number.somesig", "INC-20260714-ABC234"),
    ).toBe(false);
  });

  it("簽章長度與正確簽章不同 → 不通過（不 throw）", () => {
    const now = Date.now();
    expect(
      isValidOrderAccessCookie(`${now}.short`, "INC-20260714-ABC234"),
    ).toBe(false);
  });

  it("cookie 核發時間已超過 2 小時效期 → 不通過（伺服器端強制效期，不只靠 cookie maxAge）", () => {
    const orderNo = "INC-20260714-ABC234";
    vi.spyOn(Date, "now").mockReturnValue(1_000_000_000_000);
    const { value } = orderAccessCookieOptions(orderNo);

    vi.spyOn(Date, "now").mockReturnValue(
      1_000_000_000_000 + 2 * 60 * 60 * 1000 + 1,
    );
    expect(isValidOrderAccessCookie(value, orderNo)).toBe(false);
  });

  it("cookie 核發時間在效期內（剛好未過 2 小時）→ 通過", () => {
    const orderNo = "INC-20260714-ABC234";
    vi.spyOn(Date, "now").mockReturnValue(1_000_000_000_000);
    const { value } = orderAccessCookieOptions(orderNo);

    vi.spyOn(Date, "now").mockReturnValue(
      1_000_000_000_000 + 2 * 60 * 60 * 1000 - 1,
    );
    expect(isValidOrderAccessCookie(value, orderNo)).toBe(true);
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

describe("resolveOrderOwnership", () => {
  const order = { order_no: "INC-20260714-ABC234", member_id: "member-1" };

  it("session 使用者是訂單本人 → ownerBySession true", () => {
    const result = resolveOrderOwnership(undefined, order, {
      id: "member-1",
    });
    expect(result).toMatchObject({
      ownerBySession: true,
      cookiePresentButWrong: false,
    });
  });

  it("cookie 對應該筆訂單 → ownerByCookie true", () => {
    const cookieToken = orderAccessCookieOptions(order.order_no).value;
    const result = resolveOrderOwnership(cookieToken, order, null);
    expect(result).toMatchObject({
      ownerByCookie: true,
      cookiePresentButWrong: false,
    });
  });

  it("cookie 存在但簽章對不上這筆訂單、也非本人登入 → cookiePresentButWrong true", () => {
    const cookieToken = orderAccessCookieOptions("INC-20260714-OTHER1").value;
    const result = resolveOrderOwnership(cookieToken, order, null);
    expect(result).toMatchObject({
      ownerBySession: false,
      ownerByCookie: false,
      cookiePresentButWrong: true,
    });
  });

  it("cookie 缺席 → cookiePresentButWrong false（無法判斷，不擋，T111 情境）", () => {
    const result = resolveOrderOwnership(undefined, order, null);
    expect(result).toMatchObject({
      ownerBySession: false,
      ownerByCookie: false,
      cookiePresentButWrong: false,
    });
  });

  it("cookie 對不上但本人已登入 → 以 session 為準，不視為 cookiePresentButWrong", () => {
    const cookieToken = orderAccessCookieOptions("INC-20260714-OTHER1").value;
    const result = resolveOrderOwnership(cookieToken, order, {
      id: "member-1",
    });
    expect(result).toMatchObject({
      ownerBySession: true,
      cookiePresentButWrong: false,
    });
  });
});
