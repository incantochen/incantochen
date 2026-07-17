/* eslint-disable @typescript-eslint/no-explicit-any */
// T95（F-008）：getCart／getCartCount 對 DB 暫時性故障的行為——
// getCart throw（交給 /cart error boundary）、getCartCount fail-soft 回 0
// ＋記 Sentry，兩者都不得把故障渲染成「購物袋是空的」的完全靜默誤報。
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "guest_token" ? { value: "guest-token-1" } : undefined,
  }),
}));

const captureException = vi.fn();
const flush = vi.fn(async () => true);
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
  // 不 spread：真實 Sentry.flush(2000) 的 timeout 引數對 mock 無意義，wrapper
  // 直接零引數轉呼避免 TS2556（spread 進零參數函式）與未使用參數 lint 警告。
  flush: () => flush(),
}));

const state = {
  cart: { id: "cart-1" } as { id: string } | null,
  cartError: null as { message: string } | null,
  cartItems: [] as any[],
  cartItemsError: null as { message: string } | null,
  count: 2 as number | null,
  countError: null as { message: string } | null,
};

function makeServiceRole() {
  return {
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        maybeSingle: async () => ({
          data: state.cart,
          error: state.cartError,
        }),
        then: (resolve: (v: any) => void) => {
          // cart_item 的 await：read-cart 走 data 陣列、get-cart-count 走 count
          resolve(
            table === "cart_item"
              ? {
                  data: state.cartItems,
                  error: state.cartItemsError ?? state.countError,
                  count: state.count,
                }
              : { data: null, error: null },
          );
        },
      };
      return chain;
    },
  };
}
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => makeServiceRole(),
}));

import { getCart } from "../read-cart";
import { getCartCount } from "../get-cart-count";

// get-cart-count 用 module-scope 時間節流（同一故障窗 60s 內只送一發 Sentry）。
// 該 state 跨測試持續，若兩個 error 測試在同一實時窗內跑，後一個的 capture 會
// 被前一個節流吃掉。用 fake timer 每個測試往前推 > 60s，隔開節流窗。
let clock = 1_700_000_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  clock += 120_000;
  vi.setSystemTime(clock);
  captureException.mockClear();
  flush.mockClear();
  state.cart = { id: "cart-1" };
  state.cartError = null;
  state.cartItems = [];
  state.cartItemsError = null;
  state.count = 2;
  state.countError = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCart（T95）", () => {
  it("cart 查詢 {error} → throw，而非回 null 誤報空購物袋", async () => {
    state.cartError = { message: "connection timeout" };
    await expect(getCart()).rejects.toThrow("讀取購物車失敗");
  });

  it("cart_item 查詢 {error} → throw", async () => {
    state.cartItemsError = { message: "connection timeout" };
    await expect(getCart()).rejects.toThrow("讀取購物車品項失敗");
  });

  it("查無 cart（正常空狀態）→ 回 null，不 throw", async () => {
    state.cart = null;
    await expect(getCart()).resolves.toBeNull();
  });
});

describe("getCartCount（T95）", () => {
  it("cart 查詢 {error} → fail-soft 回 0 並記 Sentry", async () => {
    state.cartError = { message: "connection timeout" };
    await expect(getCartCount()).resolves.toBe(0);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("count 查詢 {error} → fail-soft 回 0 並記 Sentry", async () => {
    state.countError = { message: "connection timeout" };
    await expect(getCartCount()).resolves.toBe(0);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("正常路徑 → 回 count，不記 Sentry", async () => {
    await expect(getCartCount()).resolves.toBe(2);
    expect(captureException).not.toHaveBeenCalled();
  });
});
