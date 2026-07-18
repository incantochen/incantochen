/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// next/* mocks
const REDIRECT = new Error("NEXT_REDIRECT");
const redirect = vi.fn<(url: string) => never>(() => {
  throw REDIRECT;
});
let cookieJar: Record<string, string> = {};
const setCookies: Array<{ name: string; value: string }> = [];
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar[name] !== undefined ? { value: cookieJar[name] } : undefined,
    set: (options: { name: string; value: string }) => {
      setCookies.push(options);
    },
  }),
  headers: async () => ({
    get: () => null,
  }),
}));

// T73：真正的 order-access-token 依賴 env.server（未在本測試 mock），這裡只
// 驗證 checkout/actions.ts 有在 redirect 前呼叫它、不驗證簽章本身（見
// lib/order/__tests__/order-access-token.test.ts）。
vi.mock("@/lib/order/order-access-token", () => ({
  orderAccessCookieOptions: (orderNo: string) => ({
    name: "order_access_token",
    value: `signed:${orderNo}`,
  }),
}));

// T71 ultra review 限流 mock：預設一律放行，個別測試可覆寫 success 值
// T129：checkInvoiceValidateRateLimit 為新增匯出，一併 mock，否則
// actions.ts 呼叫時會因為缺這個 key 直接 TypeError。
vi.mock("@/lib/rate-limit", () => ({
  checkCheckoutGuestRateLimit: async () => state.checkoutRateLimitSuccess,
  checkInvoiceValidateRateLimit: async () =>
    state.invoiceValidateRateLimitSuccess,
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

// T42：actions.ts 引入 ECPay 統編／載具驗證（其模組鏈需要發票 env）——
// 這份測試聚焦 createOrder 自身流程，驗證行為另有 validate.test.ts；
// 預設放行，個別測試可覆寫 blocked
const checkCompanyIdentifier = vi.fn().mockResolvedValue({ blocked: false });
const checkBarcode = vi.fn().mockResolvedValue({ blocked: false });
vi.mock("@/lib/ecpay/invoice/validate", () => ({
  checkCompanyIdentifier: (...a: unknown[]) => checkCompanyIdentifier(...a),
  checkBarcode: (...a: unknown[]) => checkBarcode(...a),
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
  invoiceValidateRateLimitSuccess: true,
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
        // T81：backfillCartMemberId 走 .update().eq().is()——is 回鏈，await 由
        // 下面的 then 解析成 {error:null}（cart 表），表示 backfill 成功。
        is: () => chain,
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
        // T42 reuse 路徑會 update orders.invoice_meta；記錄後可繼續鏈 .eq()
        update: (values: any) => {
          recorded.push({ table, values });
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
  invoiceTarget: "personal" as const,
};

beforeEach(() => {
  recorded.length = 0;
  setCookies.length = 0;
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
  state.invoiceValidateRateLimitSuccess = true;
  getUser.mockResolvedValue({ data: { user: null } });
  redirect.mockClear();
  findOrCreateMember.mockClear();
  createOrderFromCart.mockReset();
  createOrderFromCart.mockResolvedValue({ ok: true, orderNo: "INC-TEST-1" });
  resolvePendingOrderForCart.mockReset();
  resolvePendingOrderForCart.mockResolvedValue({ kind: "proceed" });
  checkCompanyIdentifier.mockClear();
  checkBarcode.mockClear();
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

  // T129（F-024）：發票驗證呼叫已搬到 cart 非空確認之後，這組是回歸鎖——
  // 若順序退回「先驗證再查 cart」的舊版，以下 case 會立刻失敗。
  describe("T129（F-024）：空購物車不觸發發票驗證 API", () => {
    const emptyCartSetups: Array<[string, () => void]> = [
      [
        "無 guest_token cookie",
        () => {
          cookieJar = {};
        },
      ],
      [
        "cart 為空（無 cart row）",
        () => {
          state.cart = null;
        },
      ],
      [
        "cart_item 為空",
        () => {
          state.cartItems = [];
        },
      ],
    ];

    // 三種空購物車成因都要擋下——覆蓋主要 invoiceTarget（company）。
    it.each(emptyCartSetups)(
      "%s ＋ invoiceTarget=company → 不呼叫 checkCompanyIdentifier／checkBarcode",
      async (_label, setup) => {
        setup();
        const result = await createOrder({
          ...FORM,
          invoiceTarget: "company",
          taxId: "12345678",
        });
        expect(result).toMatchObject({ ok: false });
        expect(checkCompanyIdentifier).not.toHaveBeenCalled();
        expect(checkBarcode).not.toHaveBeenCalled();
      },
    );

    // 補一個 mobile_barcode 案例，確認守衛不是只對 company 生效
    // （其餘空購物車成因與 company 案例共用同一組早期 return，不重複覆蓋）。
    it("cart 為空 ＋ invoiceTarget=mobile_barcode → 不呼叫 checkBarcode／checkCompanyIdentifier", async () => {
      state.cart = null;
      const result = await createOrder({
        ...FORM,
        invoiceTarget: "mobile_barcode",
        carrierBarcode: "/ABC1234",
      });
      expect(result).toMatchObject({ ok: false });
      expect(checkCompanyIdentifier).not.toHaveBeenCalled();
      expect(checkBarcode).not.toHaveBeenCalled();
    });
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
      expect.anything(),
    );
    expect(redirect).toHaveBeenCalledWith("/checkout/pay?order=INC-EXISTING-1");
    expect(findOrCreateMember).not.toHaveBeenCalled();
    expect(createOrderFromCart).not.toHaveBeenCalled();
    expect(setCookies).toContainEqual({
      name: "order_access_token",
      value: "signed:INC-EXISTING-1",
    });
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

  it("T42：reuse 路徑仍以本次發票去向更新 invoice_meta（改選統編重送不被舊值沿用）", async () => {
    resolvePendingOrderForCart.mockResolvedValue({
      kind: "reuse",
      orderNo: "INC-EXISTING-1",
    });

    await expect(
      createOrder({ ...FORM, invoiceTarget: "company", taxId: "12345678" }),
    ).rejects.toBe(REDIRECT);

    expect(recorded).toContainEqual({
      table: "orders",
      values: {
        invoice_meta: { target: "company", customer_identifier: "12345678" },
      },
    });
  });
});

describe("T42：發票去向 ECPay 驗證（建單前擋明確無效值）", () => {
  it("統編驗證 blocked → 回錯誤、不建單", async () => {
    checkCompanyIdentifier.mockResolvedValueOnce({
      blocked: true,
      error: "統一編號格式錯誤，請確認後重新輸入",
    });

    const result = await createOrder({
      ...FORM,
      invoiceTarget: "company",
      taxId: "12345678",
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("統一編號"),
    });
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("手機條碼驗證 blocked → 回錯誤、不建單", async () => {
    checkBarcode.mockResolvedValueOnce({
      blocked: true,
      error: "手機條碼格式正確但查無歸戶紀錄，請確認後重新輸入",
    });

    const result = await createOrder({
      ...FORM,
      invoiceTarget: "mobile_barcode",
      carrierBarcode: "/ABC1234",
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("手機條碼"),
    });
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("personal 不打任何驗證 API", async () => {
    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);
    expect(checkCompanyIdentifier).not.toHaveBeenCalled();
    expect(checkBarcode).not.toHaveBeenCalled();
  });

  // T129（F-024）：驗證呼叫前的限流閘。
  it("company 分支被限流 → 回請求太頻繁，不呼叫驗證 API、不建單", async () => {
    state.invoiceValidateRateLimitSuccess = false;

    const result = await createOrder({
      ...FORM,
      invoiceTarget: "company",
      taxId: "12345678",
    });

    expect(result).toMatchObject({
      ok: false,
      error: "請求太頻繁，請稍後再試",
    });
    expect(checkCompanyIdentifier).not.toHaveBeenCalled();
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });

  it("personal 分支即使限流命中也不受影響（不進限流檢查）", async () => {
    state.invoiceValidateRateLimitSuccess = false;

    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    expect(checkCompanyIdentifier).not.toHaveBeenCalled();
    expect(checkBarcode).not.toHaveBeenCalled();
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
      { target: "personal" },
    );
    expect(redirect).toHaveBeenCalledWith("/checkout/pay?order=INC-TEST-1");
    expect(setCookies).toContainEqual({
      name: "order_access_token",
      value: "signed:INC-TEST-1",
    });
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
      { target: "personal" },
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
      { target: "personal" },
    );
  });

  // T81：登入者即使沒有 guest cookie，也以 member_id 找到會員車、正常建單。
  it("已登入且無 guest cookie → 以 member 車建單", async () => {
    cookieJar = {};
    getUser.mockResolvedValue({
      data: { user: { id: "member-logged-in", email: "m@example.com" } },
    });

    await createOrder(FORM).catch((e) => {
      if (e !== REDIRECT) throw e;
    });

    expect(createOrderFromCart).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "member-logged-in",
      expect.anything(),
      { target: "personal" },
    );
  });

  // T81：訪客結帳建新會員後，backfill 把當前 cart 掛給新會員（保留 guest_token），
  // 仍正常建單。fail-soft 的錯誤路徑另在 merge-guest-cart.test.ts 覆蓋。
  it("訪客建新會員 → backfill 把 cart 掛給新會員（member_id）、仍建單成功", async () => {
    // getUser 預設 null（訪客）、state.member null → 走 createUser 建新會員。
    await createOrder(FORM).catch((e) => {
      if (e !== REDIRECT) throw e;
    });

    const cartBackfill = recorded.find(
      (r) => r.table === "cart" && r.values?.member_id === "member-new",
    );
    expect(cartBackfill).toBeDefined();
    expect(createOrderFromCart).toHaveBeenCalled();
  });
});
