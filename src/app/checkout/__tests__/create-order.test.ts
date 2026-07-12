/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// next/* mocks
const REDIRECT = new Error("NEXT_REDIRECT");
const redirect = vi.fn<(url: string) => never>(() => {
  throw REDIRECT;
});
let cookieJar: Record<string, string> = {};
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar[name] !== undefined ? { value: cookieJar[name] } : undefined,
  }),
  headers: async () => ({
    get: () => null,
  }),
}));

// T71 ultra review 限流 mock：預設一律放行，個別測試可覆寫 success 值
vi.mock("@/lib/rate-limit", () => ({
  checkCheckoutGuestRateLimit: async () => state.checkoutRateLimitSuccess,
}));

// auth：預設未登入；member 建立走 mock
const getUser = vi.fn().mockResolvedValue({ data: { user: null } });
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
const findOrCreateMember = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth/find-or-create-member", () => ({
  findOrCreateMember: (...a: unknown[]) => findOrCreateMember(...a),
}));

// 共用建單核心：programmable 結果，這裡只驗證 createOrder() 自己的邏輯
// （guestToken 讀取、rate limit、dedup 先於會員解析、會員解析），不重複測
// 驗價／RPC 內部邏輯（見 lib/order/__tests__/create-order-from-cart.test.ts）。
const createOrderFromCart = vi.fn();
const resolvePendingOrderForCart = vi.fn();
vi.mock("@/lib/order/create-order-from-cart", () => ({
  createOrderFromCart: (...a: unknown[]) => createOrderFromCart(...a),
  resolvePendingOrderForCart: (...a: unknown[]) =>
    resolvePendingOrderForCart(...a),
}));

// service role：table 路由＋操作記錄器
type Recorded = { table: string; values: any };
const recorded: Recorded[] = [];
const state = {
  cart: { id: "cart-1", updated_at: "2026-07-10T00:00:00+00:00" } as {
    id: string;
    updated_at: string;
  } | null,
  cartItems: [
    {
      id: "ci-1",
      product_id: "11111111-1111-4111-8111-111111111111",
      quantity: 1,
      unit_price_snapshot: 25000,
      config_snapshot: {},
    },
  ] as any[] | null,
  member: null as { id: string } | null,
  createdUser: { id: "member-new" },
  createUserError: null as any,
  checkoutRateLimitSuccess: true,
};

function makeServiceRole() {
  return {
    auth: {
      admin: {
        createUser: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              state.createUserError
                ? { data: { user: null }, error: state.createUserError }
                : { data: { user: state.createdUser }, error: null },
            ),
          ),
      },
    },
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => {
          if (table === "cart") return Promise.resolve({ data: state.cart });
          if (table === "member")
            return Promise.resolve({ data: state.member });
          return Promise.resolve({ data: null });
        },
        insert: (values: any) => {
          recorded.push({ table, values });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: table === "cart_item" ? state.cartItems : null,
            error: null,
          }),
      };
      return chain;
    },
  };
}
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => makeServiceRole(),
}));

import { createOrder } from "../actions";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FORM = {
  email: "buyer@example.com",
  recipientName: "王小明",
  recipientPhone: "0912345678",
  zipCode: "106",
  shippingAddress: "台北市大安區測試路 1 號",
  customConsent: true as const,
};

beforeEach(() => {
  recorded.length = 0;
  cookieJar = { guest_token: "guest-abc" };
  state.cart = { id: "cart-1", updated_at: "2026-07-10T00:00:00+00:00" };
  state.cartItems = [
    {
      id: "ci-1",
      product_id: "11111111-1111-4111-8111-111111111111",
      quantity: 1,
      unit_price_snapshot: 25000,
      config_snapshot: {},
    },
  ];
  state.member = null;
  state.createUserError = null;
  state.checkoutRateLimitSuccess = true;
  getUser.mockResolvedValue({ data: { user: null } });
  redirect.mockClear();
  findOrCreateMember.mockClear();
  createOrderFromCart.mockReset();
  createOrderFromCart.mockResolvedValue({ ok: true, orderNo: "INC-TEST-1" });
  resolvePendingOrderForCart.mockReset();
  resolvePendingOrderForCart.mockResolvedValue({ kind: "proceed" });
});

// ---------------------------------------------------------------------------

describe("前置檢查", () => {
  it("無 guest_token cookie → 回空購物車錯誤、不建單", async () => {
    cookieJar = {};
    const result = await createOrder(FORM);
    expect(result).toMatchObject({ ok: false });
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("cart 為空（無 cart row）→ 回空購物車錯誤、不建單", async () => {
    state.cart = null;
    const result = await createOrder(FORM);
    expect(result).toMatchObject({ ok: false });
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("cart_item 為空 → 回空購物車錯誤、不建單", async () => {
    state.cartItems = [];
    const result = await createOrder(FORM);
    expect(result).toMatchObject({ ok: false });
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("表單驗證失敗（缺同意勾選）→ 回錯誤", async () => {
    const result = await createOrder({ ...FORM, customConsent: false as any });
    expect(result).toMatchObject({ ok: false });
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });
});

describe("pending 訂單 dedup（T75，須在會員解析之前）", () => {
  it("dedup 回 reuse → 直接 redirect 既有訂單付款頁，不做會員解析、不建單", async () => {
    resolvePendingOrderForCart.mockResolvedValue({
      kind: "reuse",
      orderNo: "INC-EXISTING-1",
    });

    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    expect(resolvePendingOrderForCart).toHaveBeenCalledWith(
      expect.anything(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
    );
    expect(redirect).toHaveBeenCalledWith("/checkout/pay?order=INC-EXISTING-1");
    expect(findOrCreateMember).not.toHaveBeenCalled();
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("F1 回歸鎖：email 命中既有會員、但同 cart 有未變更的 pending 訂單 → 直接導付款頁，不回 requiresLogin", async () => {
    // 訪客第一次成功建單時 member row 已建立；重送未變更 cart 必須跟原版
    // 一樣直接進付款頁，不能先跑會員解析撞上「email 已註冊請登入」。
    state.member = { id: "member-existing" };
    resolvePendingOrderForCart.mockResolvedValue({
      kind: "reuse",
      orderNo: "INC-EXISTING-1",
    });

    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    expect(redirect).toHaveBeenCalledWith("/checkout/pay?order=INC-EXISTING-1");
  });

  it("dedup 回 error → fail-closed 回錯誤，不做會員解析、不建單", async () => {
    resolvePendingOrderForCart.mockResolvedValue({
      kind: "error",
      error: "建立訂單失敗，請稍後再試",
    });

    const result = await createOrder(FORM);

    expect(result).toMatchObject({ ok: false });
    expect(findOrCreateMember).not.toHaveBeenCalled();
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });
});

describe("委派給 createOrderFromCart", () => {
  it("成功 → 帶正確參數呼叫共用函式、redirect 到付款頁", async () => {
    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    expect(createOrderFromCart).toHaveBeenCalledWith(
      expect.anything(),
      "cart-1",
      state.cartItems,
      "member-new",
      {
        recipientName: FORM.recipientName,
        recipientPhone: FORM.recipientPhone,
        zipCode: FORM.zipCode,
        shippingAddress: FORM.shippingAddress,
      },
    );
    expect(redirect).toHaveBeenCalledWith("/checkout/pay?order=INC-TEST-1");
  });

  it("失敗（例如 priceUpdated）→ 原樣回傳，不 redirect", async () => {
    createOrderFromCart.mockResolvedValue({
      ok: false,
      error: "商品金額已更新，請確認新金額後再次送出",
      priceUpdated: true,
    });

    const result = await createOrder(FORM);

    expect(result).toMatchObject({ ok: false, priceUpdated: true });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("結帳即會員", () => {
  it("email 對應既有會員 → 要求登入、不掛單（T71 修復）", async () => {
    state.member = { id: "member-existing" };

    const result = await createOrder(FORM);

    expect(result).toMatchObject({ ok: false, requiresLogin: true });
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("訪客結帳被限流 → 回通用訊息、不查會員也不建單（T71 ultra review：防 email 存在性 oracle）", async () => {
    state.checkoutRateLimitSuccess = false;
    state.member = { id: "member-existing" };

    const result = await createOrder(FORM);

    expect(result).toMatchObject({
      ok: false,
      error: "請求太頻繁，請稍後再試",
    });
    expect(result).not.toHaveProperty("requiresLogin");
    expect(findOrCreateMember).not.toHaveBeenCalled();
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("新建帳號競態撞號 → 要求登入、不掛單，訊息與既有會員分支一致", async () => {
    state.member = { id: "member-existing" };
    const existingMemberResult = (await createOrder(FORM)) as {
      ok: false;
      error: string;
    };

    state.member = null;
    state.createUserError = { message: "User already registered" };
    const raceResult = (await createOrder(FORM)) as {
      ok: false;
      error: string;
    };

    expect(raceResult).toMatchObject({ ok: false, requiresLogin: true });
    expect(raceResult.error).toBe(existingMemberResult.error);
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("email 大小寫混雜 → 正規化為小寫後才查會員／建帳號（T71 防繞過）", async () => {
    await createOrder({
      ...FORM,
      email: "Buyer@Example.COM",
    }).catch((e) => {
      if (e !== REDIRECT) throw e;
    });

    expect(findOrCreateMember).toHaveBeenCalledWith(
      "member-new",
      "buyer@example.com",
    );
  });

  it("新 email → admin createUser＋findOrCreateMember → 以新會員呼叫 createOrderFromCart", async () => {
    await createOrder(FORM).catch((e) => {
      if (e !== REDIRECT) throw e;
    });

    expect(findOrCreateMember).toHaveBeenCalledWith("member-new", FORM.email);
    expect(createOrderFromCart).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "member-new",
      expect.anything(),
    );
  });

  it("createUser 回結構化錯誤碼 email_exists → 要求登入（T71 ultra review #4）", async () => {
    state.createUserError = { code: "email_exists", message: "unused text" };
    const result = await createOrder(FORM);

    expect(result).toMatchObject({ ok: false, requiresLogin: true });
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("已登入使用者 session email 大小寫混雜 → 正規化後才寫入 member（T71 ultra review #3）", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "member-logged-in", email: "Logged@In.COM" } },
    });

    await createOrder(FORM).catch((e) => {
      if (e !== REDIRECT) throw e;
    });

    expect(findOrCreateMember).toHaveBeenCalledWith(
      "member-logged-in",
      "logged@in.com",
    );
    expect(createOrderFromCart).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "member-logged-in",
      expect.anything(),
    );
  });
});
