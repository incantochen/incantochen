/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// next/* mocks
const REDIRECT = new Error("NEXT_REDIRECT");
const redirect = vi.fn(() => {
  throw REDIRECT;
});
const revalidatePath = vi.fn();
let cookieJar: Record<string, string> = {};
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
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

// 驗價：可程式化結果
const verifyCartPrices = vi.fn();
vi.mock("@/lib/quote/verify-prices", () => ({
  verifyCartPrices: (...a: unknown[]) => verifyCartPrices(...a),
}));

// service role：table 路由＋操作記錄器
type Insert = { table: string; values: any };
const recorded: Insert[] = [];
const deletes: string[] = [];
const state = {
  cart: { id: "cart-1" } as { id: string } | null,
  cartItems: [
    {
      id: "ci-1",
      product_id: "prod-1",
      quantity: 1,
      unit_price_snapshot: 25000,
      config_snapshot: {},
    },
  ] as any[] | null,
  member: null as { id: string } | null,
  // orders insert 每次呼叫的回傳（依序消耗）
  orderInsertResults: [] as { data: any; error: any }[],
  orderItemInsertError: null as any,
  createdUser: { id: "member-new" },
  createUserError: null as any,
  checkoutRateLimitSuccess: true,
};

function ordersChain() {
  const chain: any = {
    insert: (values: any) => {
      recorded.push({ table: "orders", values });
      return chain;
    },
    select: () => chain,
    single: () =>
      Promise.resolve(
        state.orderInsertResults.shift() ?? {
          data: { id: "order-1" },
          error: null,
        },
      ),
  };
  return chain;
}

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
      if (table === "orders") return ordersChain();
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "cart" ? state.cart : state.member,
          }),
        update: (values: any) => {
          recorded.push({ table, values });
          return chain;
        },
        insert: (values: any) => {
          recorded.push({ table, values });
          return Promise.resolve({
            error: table === "order_item" ? state.orderItemInsertError : null,
          });
        },
        delete: () => {
          deletes.push(table);
          return chain;
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

const VERIFIED_OK = [
  {
    cartItemId: "ci-1",
    productId: "prod-1",
    productName: "祖母綠戒指",
    quantity: 1,
    verifiedUnitPrice: 25000,
    configSnapshot: {},
    priceChanged: false,
  },
];

beforeEach(() => {
  recorded.length = 0;
  deletes.length = 0;
  cookieJar = { guest_token: "guest-abc" };
  state.cart = { id: "cart-1" };
  state.member = null;
  state.orderInsertResults = [];
  state.orderItemInsertError = null;
  state.createUserError = null;
  state.checkoutRateLimitSuccess = true;
  getUser.mockResolvedValue({ data: { user: null } });
  verifyCartPrices.mockResolvedValue(VERIFIED_OK);
  redirect.mockClear();
  revalidatePath.mockClear();
  findOrCreateMember.mockClear();
});

// ---------------------------------------------------------------------------

describe("前置檢查", () => {
  it("無 guest_token cookie → 回空購物車錯誤、不建單", async () => {
    cookieJar = {};
    const result = await createOrder(FORM);
    expect(result).toMatchObject({ ok: false });
    expect(recorded.filter((r) => r.table === "orders")).toHaveLength(0);
  });

  it("表單驗證失敗（缺同意勾選）→ 回錯誤", async () => {
    const result = await createOrder({ ...FORM, customConsent: false as any });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("伺服器端驗價（T41 紅線）", () => {
  it("驗價金額有變 → 更新 cart_item 快照、revalidate、回 priceUpdated、不建單", async () => {
    verifyCartPrices.mockResolvedValue([
      { ...VERIFIED_OK[0], verifiedUnitPrice: 26000, priceChanged: true },
    ]);

    const result = await createOrder(FORM);

    expect(result).toMatchObject({ ok: false, priceUpdated: true });
    const cartItemUpdate = recorded.find((r) => r.table === "cart_item");
    expect(cartItemUpdate?.values.unit_price_snapshot).toBe(26000);
    // T78：價格變動走的 cart_item 快照更新也算「購物車活動」，必須 touch
    // cart.updated_at，否則這張還在走驗價流程的購物車可能被 90 天清理誤刪。
    const cartTouch = recorded.find(
      (r) => r.table === "cart" && r.values.updated_at,
    );
    expect(cartTouch).toBeTruthy();
    expect(revalidatePath).toHaveBeenCalledWith("/cart");
    expect(recorded.filter((r) => r.table === "orders")).toHaveLength(0);
  });

  it("驗價拋錯（商品下架）→ 回錯誤、不建單", async () => {
    verifyCartPrices.mockRejectedValue(new Error("商品已下架"));
    const result = await createOrder(FORM);
    expect(result).toMatchObject({ ok: false, error: "商品已下架" });
    expect(recorded.filter((r) => r.table === "orders")).toHaveLength(0);
  });

  it("訂單金額採驗證後價格，非 cart 快照價", async () => {
    // cart 快照被竄改為 1 元；驗價回傳正確 25000 → 訂單必須用 25000
    state.cartItems = [{ ...state.cartItems![0], unit_price_snapshot: 1 }];

    await createOrder(FORM).catch((e) => {
      if (e !== REDIRECT) throw e;
    });

    const orderInsert = recorded.find((r) => r.table === "orders");
    expect(orderInsert?.values.subtotal).toBe(25000);
    expect(orderInsert?.values.total_amount).toBe(25000);
    const itemInsert = recorded.find((r) => r.table === "order_item");
    expect(itemInsert?.values[0].unit_price_snapshot).toBe(25000);
  });
});

describe("order_no 碰撞重試", () => {
  it("首次 23505 → 換號重試一次成功 → redirect 至付款頁", async () => {
    state.orderInsertResults = [
      { data: null, error: { code: "23505" } },
      { data: { id: "order-2" }, error: null },
    ];

    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    expect(recorded.filter((r) => r.table === "orders")).toHaveLength(2);
    const [first, second] = recorded.filter((r) => r.table === "orders");
    expect(first.values.order_no).not.toBe(second.values.order_no);
    expect(redirect).toHaveBeenCalledWith(
      expect.stringMatching(/^\/checkout\/pay\?order=INC-/),
    );
  });

  it("重試仍失敗 → 回建單失敗錯誤", async () => {
    state.orderInsertResults = [
      { data: null, error: { code: "23505" } },
      { data: null, error: { code: "23505" } },
    ];
    const result = await createOrder(FORM);
    expect(result).toMatchObject({ ok: false });
  });
});

describe("明細寫入與清車", () => {
  it("order_item 失敗 → 回錯誤且訊息含訂單號、不清購物車", async () => {
    state.orderItemInsertError = { message: "boom" };
    const result = (await createOrder(FORM)) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/INC-/);
    expect(deletes).not.toContain("cart");
  });

  it("成功路徑 → order＋order_item 寫入、清購物車、redirect", async () => {
    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    expect(recorded.find((r) => r.table === "orders")).toBeTruthy();
    const itemInsert = recorded.find((r) => r.table === "order_item");
    expect(itemInsert?.values[0].product_name_snapshot).toBe("祖母綠戒指");
    expect(deletes).toContain("cart");
  });
});

describe("結帳即會員", () => {
  it("email 對應既有會員 → 要求登入、不掛單（T71 修復）", async () => {
    state.member = { id: "member-existing" };

    const result = await createOrder(FORM);

    expect(result).toMatchObject({ ok: false, requiresLogin: true });
    expect(recorded.filter((r) => r.table === "orders")).toHaveLength(0);
    expect(recorded.filter((r) => r.table === "order_item")).toHaveLength(0);
  });

  it("訪客結帳被限流 → 回通用訊息、不查會員也不建單（T71 ultra review：防 email 存在性 oracle）", async () => {
    state.checkoutRateLimitSuccess = false;
    state.member = { id: "member-existing" };

    const result = await createOrder(FORM);

    expect(result).toMatchObject({ ok: false, error: "請求太頻繁，請稍後再試" });
    expect(result).not.toHaveProperty("requiresLogin");
    expect(recorded).toHaveLength(0);
    expect(findOrCreateMember).not.toHaveBeenCalled();
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
    expect(recorded.filter((r) => r.table === "orders")).toHaveLength(0);
    expect(recorded.filter((r) => r.table === "order_item")).toHaveLength(0);
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

  it("新 email → admin createUser＋findOrCreateMember → 訂單掛新會員", async () => {
    await createOrder(FORM).catch((e) => {
      if (e !== REDIRECT) throw e;
    });

    expect(findOrCreateMember).toHaveBeenCalledWith("member-new", FORM.email);
    const orderInsert = recorded.find((r) => r.table === "orders");
    expect(orderInsert?.values.member_id).toBe("member-new");
  });

  it("createUser 回結構化錯誤碼 email_exists → 要求登入（T71 ultra review #4）", async () => {
    state.createUserError = { code: "email_exists", message: "unused text" };
    const result = await createOrder(FORM);

    expect(result).toMatchObject({ ok: false, requiresLogin: true });
    expect(recorded).toHaveLength(0);
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
  });
});
