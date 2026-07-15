/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let cookieJar: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar[name] !== undefined ? { value: cookieJar[name] } : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

const requireAdmin = vi.fn().mockResolvedValue({ email: "admin@example.com" });
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
}));

const findOrCreateMemberByEmail = vi.fn();
vi.mock("@/lib/auth/find-or-create-member", () => ({
  findOrCreateMemberByEmail: (...a: unknown[]) =>
    findOrCreateMemberByEmail(...a),
}));

const createOrderFromCart = vi.fn();
const resolvePendingOrderForCart = vi.fn();
vi.mock("@/lib/order/create-order-from-cart", () => ({
  createOrderFromCart: (...a: unknown[]) => createOrderFromCart(...a),
  resolvePendingOrderForCart: (...a: unknown[]) =>
    resolvePendingOrderForCart(...a),
}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: { NEXT_PUBLIC_SITE_URL: "https://example.com" },
}));

const state = {
  cart: { id: "cart-1", updated_at: "2026-07-10T00:00:00+00:00" } as {
    id: string;
    updated_at: string;
  } | null,
  cartError: null as { message?: string } | null,
  cartItems: [
    {
      id: "ci-1",
      product_id: "11111111-1111-4111-8111-111111111111",
      quantity: 1,
      unit_price_snapshot: 25000,
      config_snapshot: {},
    },
  ] as any[] | null,
  cartItemsError: null as { message?: string } | null,
};

function makeServiceRole() {
  return {
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => {
          if (table === "cart")
            return Promise.resolve({
              data: state.cart,
              error: state.cartError,
            });
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: table === "cart_item" ? state.cartItems : null,
            error: table === "cart_item" ? state.cartItemsError : null,
          }),
      };
      return chain;
    },
  };
}
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => makeServiceRole(),
}));

import { createAdminOrderFromCart } from "../actions";

const FORM = {
  email: "buyer@example.com",
  recipientName: "王小明",
  recipientPhone: "0912345678",
  zipCode: "106",
  shippingAddress: "台北市大安區測試路 1 號",
  customConsent: true as const,
  invoiceTarget: "personal" as const,
};

beforeEach(() => {
  cookieJar = { guest_token: "admin-guest-token" };
  state.cart = { id: "cart-1", updated_at: "2026-07-10T00:00:00+00:00" };
  state.cartError = null;
  state.cartItems = [
    {
      id: "ci-1",
      product_id: "11111111-1111-4111-8111-111111111111",
      quantity: 1,
      unit_price_snapshot: 25000,
      config_snapshot: {},
    },
  ];
  state.cartItemsError = null;
  requireAdmin.mockClear();
  findOrCreateMemberByEmail.mockReset();
  findOrCreateMemberByEmail.mockResolvedValue({
    ok: true,
    memberId: "member-new",
  });
  createOrderFromCart.mockReset();
  createOrderFromCart.mockResolvedValue({ ok: true, orderNo: "INC-ADMIN-1" });
  resolvePendingOrderForCart.mockReset();
  resolvePendingOrderForCart.mockResolvedValue({ kind: "proceed" });
});

describe("createAdminOrderFromCart", () => {
  it("要求 requireAdmin 守衛", async () => {
    await createAdminOrderFromCart(FORM);
    expect(requireAdmin).toHaveBeenCalled();
  });

  it("購物袋是空的（無 guest_token）→ 回錯誤，不查會員", async () => {
    cookieJar = {};
    const result = await createAdminOrderFromCart(FORM);
    expect(result).toMatchObject({ ok: false });
    expect(findOrCreateMemberByEmail).not.toHaveBeenCalled();
  });

  it("購物袋是空的（cart_item 為空）→ 回錯誤，不查會員", async () => {
    state.cartItems = [];
    const result = await createAdminOrderFromCart(FORM);
    expect(result).toMatchObject({ ok: false });
    expect(findOrCreateMemberByEmail).not.toHaveBeenCalled();
  });

  it("cart 查詢失敗 → 回「讀取購物袋失敗」而非「購物袋是空的」（§6 查詢失敗 ≠ 查無資料）", async () => {
    state.cartError = { message: "connection timeout" };
    const result = await createAdminOrderFromCart(FORM);
    expect(result).toMatchObject({
      ok: false,
      error: "讀取購物袋失敗，請稍後再試",
    });
    expect(findOrCreateMemberByEmail).not.toHaveBeenCalled();
  });

  it("cart_item 查詢失敗 → 回「讀取購物袋失敗」，不查會員", async () => {
    state.cartItemsError = { message: "connection timeout" };
    const result = await createAdminOrderFromCart(FORM);
    expect(result).toMatchObject({
      ok: false,
      error: "讀取購物袋失敗，請稍後再試",
    });
    expect(findOrCreateMemberByEmail).not.toHaveBeenCalled();
  });

  it("email 命中既有會員 → 用該 memberId 建單", async () => {
    findOrCreateMemberByEmail.mockResolvedValue({
      ok: true,
      memberId: "member-existing",
    });

    await createAdminOrderFromCart(FORM);

    expect(createOrderFromCart).toHaveBeenCalledWith(
      expect.anything(),
      "cart-1",
      state.cartItems,
      "member-existing",
      expect.objectContaining({ recipientName: FORM.recipientName }),
    );
  });

  it("email 需代建會員，helper 失敗 → 原樣回傳錯誤，不呼叫 createOrderFromCart", async () => {
    findOrCreateMemberByEmail.mockResolvedValue({
      ok: false,
      error: "建立會員失敗，請稍後再試",
    });

    const result = await createAdminOrderFromCart(FORM);

    expect(result).toMatchObject({
      ok: false,
      error: "建立會員失敗，請稍後再試",
    });
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("dedup 帶 memberId 呼叫（admin 換 email 重送不得沿用錯誤客戶的舊單）", async () => {
    findOrCreateMemberByEmail.mockResolvedValue({
      ok: true,
      memberId: "member-correct",
    });

    await createAdminOrderFromCart(FORM);

    expect(resolvePendingOrderForCart).toHaveBeenCalledWith(
      expect.anything(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      expect.anything(),
      "member-correct",
    );
  });

  it("dedup 回 reuse → 付款連結組既有訂單號，不建新單", async () => {
    resolvePendingOrderForCart.mockResolvedValue({
      kind: "reuse",
      orderNo: "INC-EXISTING-1",
    });

    const result = await createAdminOrderFromCart(FORM);

    expect(result).toMatchObject({
      ok: true,
      orderNo: "INC-EXISTING-1",
      paymentLink: "https://example.com/checkout/pay?order=INC-EXISTING-1",
    });
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("dedup 回 error → fail-closed 回錯誤，不建單", async () => {
    resolvePendingOrderForCart.mockResolvedValue({
      kind: "error",
      error: "建立訂單失敗，請稍後再試",
    });

    const result = await createAdminOrderFromCart(FORM);

    expect(result).toMatchObject({ ok: false });
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("成功 → 用 URL API 組出新訂單號的付款連結", async () => {
    createOrderFromCart.mockResolvedValue({
      ok: true,
      orderNo: "INC-NEW-1",
    });

    const result = await createAdminOrderFromCart(FORM);

    expect(result).toMatchObject({
      ok: true,
      orderNo: "INC-NEW-1",
      paymentLink: "https://example.com/checkout/pay?order=INC-NEW-1",
    });
  });

  it("createOrderFromCart 回傳 priceUpdated → 原樣回傳", async () => {
    createOrderFromCart.mockResolvedValue({
      ok: false,
      error: "商品金額已更新，請重新確認後再次送出",
      priceUpdated: true,
    });

    const result = await createAdminOrderFromCart(FORM);

    expect(result).toMatchObject({ ok: false, priceUpdated: true });
  });

  it("表單驗證失敗 → 回錯誤，不查購物車", async () => {
    const result = await createAdminOrderFromCart({
      ...FORM,
      customConsent: false as any,
    });
    expect(result).toMatchObject({ ok: false });
    expect(findOrCreateMemberByEmail).not.toHaveBeenCalled();
  });
});
