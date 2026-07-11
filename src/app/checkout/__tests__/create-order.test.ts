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

// 狀態機：dedup 發現購物車已變更時會呼叫 transitionOrder 取消舊單；
// 其行為已在 state-machine.test.ts 覆蓋，這裡 mock 掉專注在 createOrder 邏輯。
const { transitionOrder, OrderTransitionRaceError } = vi.hoisted(() => {
  class OrderTransitionRaceError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "OrderTransitionRaceError";
    }
  }
  return { transitionOrder: vi.fn(), OrderTransitionRaceError };
});
vi.mock("@/lib/order/state-machine", () => ({
  transitionOrder: (...a: unknown[]) => transitionOrder(...a),
  OrderTransitionRaceError,
}));

// service role：table 路由＋操作記錄器
type Recorded = { table: string; values: any };
const recorded: Recorded[] = [];
const deletes: string[] = [];
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
  // 同一張 cart 是否已有 pending_payment 訂單（重複結帳防護，見 actions.ts）。
  existingPendingOrder: null as {
    id: string;
    order_no: string;
    created_at: string;
  } | null,
  // uq_orders_one_pending_per_cart 碰撞後的重查結果（見 actions.ts racedOrder）。
  // 與 existingPendingOrder 是同一張表的兩次不同查詢，靠 ordersMaybeSingleCalls
  // 計數器分流（見 makeServiceRole 的 from("orders") 分支）。
  racedOrder: null as { order_no: string } | null,
  racedOrderError: null as { message?: string } | null,
  // create_order_with_items RPC 每次呼叫的回傳（依序消耗）——T76 改用單一
  // RPC 交易化後，order_no 23505 碰撞重試是「重新呼叫 RPC」而非分段 insert。
  rpcResults: [] as { data: any; error: any }[],
  createdUser: { id: "member-new" },
  createUserError: null as any,
  checkoutRateLimitSuccess: true,
};

function rpcCalls() {
  return recorded.filter((r) => r.table === "rpc:create_order_with_items");
}

// orders 表在同一次 createOrder() 呼叫裡可能被查兩次：① T75 建單前 dedup
// 預檢查、② uq_orders_one_pending_per_cart 碰撞後的 racedOrder 重查。兩次
// 語意不同（① 沒撞到才會走到 RPC，② 是 RPC 撞到之後才查），靠呼叫次數分流。
let ordersMaybeSingleCalls = 0;

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
    rpc: (name: string, params: any) => {
      recorded.push({ table: `rpc:${name}`, values: params });
      return Promise.resolve(
        state.rpcResults.shift() ?? { data: { id: "order-1" }, error: null },
      );
    },
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          if (table === "cart") return Promise.resolve({ data: state.cart });
          if (table === "member")
            return Promise.resolve({ data: state.member });
          if (table === "orders") {
            ordersMaybeSingleCalls += 1;
            if (ordersMaybeSingleCalls === 1) {
              return Promise.resolve({
                data: state.existingPendingOrder,
                error: null,
              });
            }
            return Promise.resolve({
              data: state.racedOrder,
              error: state.racedOrderError,
            });
          }
          return Promise.resolve({ data: null });
        },
        update: (values: any) => {
          recorded.push({ table, values });
          return chain;
        },
        insert: (values: any) => {
          recorded.push({ table, values });
          return Promise.resolve({ error: null });
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
    productId: "11111111-1111-4111-8111-111111111111",
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
  state.cart = { id: "cart-1", updated_at: "2026-07-10T00:00:00+00:00" };
  state.member = null;
  state.createUserError = null;
  state.checkoutRateLimitSuccess = true;
  state.existingPendingOrder = null;
  state.racedOrder = null;
  state.racedOrderError = null;
  state.rpcResults = [];
  ordersMaybeSingleCalls = 0;
  transitionOrder.mockReset();
  transitionOrder.mockResolvedValue(undefined);
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
    expect(rpcCalls()).toHaveLength(0);
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
    expect(rpcCalls()).toHaveLength(0);
  });

  it("驗價拋錯（商品下架）→ 回錯誤、不建單", async () => {
    verifyCartPrices.mockRejectedValue(new Error("商品已下架"));
    const result = await createOrder(FORM);
    expect(result).toMatchObject({ ok: false, error: "商品已下架" });
    expect(rpcCalls()).toHaveLength(0);
  });

  it("訂單金額採驗證後價格，非 cart 快照價", async () => {
    // cart 快照被竄改為 1 元；驗價回傳正確 25000 → 訂單必須用 25000
    state.cartItems = [{ ...state.cartItems![0], unit_price_snapshot: 1 }];

    await createOrder(FORM).catch((e) => {
      if (e !== REDIRECT) throw e;
    });

    const call = rpcCalls()[0]!;
    expect(call.values.p_subtotal).toBe(25000);
    expect(call.values.p_total_amount).toBe(25000);
    expect(call.values.p_items[0].unit_price_snapshot).toBe(25000);
  });
});

describe("order_no 碰撞重試", () => {
  it("首次 23505 → 換號重試一次成功 → redirect 至付款頁", async () => {
    state.rpcResults = [
      { data: null, error: { code: "23505" } },
      { data: { id: "order-2" }, error: null },
    ];

    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    expect(rpcCalls()).toHaveLength(2);
    const [first, second] = rpcCalls();
    expect(first!.values.p_order_no).not.toBe(second!.values.p_order_no);
    expect(redirect).toHaveBeenCalledWith(
      expect.stringMatching(/^\/checkout\/pay\?order=INC-/),
    );
  });

  it("重試仍失敗 → 回建單失敗錯誤", async () => {
    state.rpcResults = [
      { data: null, error: { code: "23505" } },
      { data: null, error: { code: "23505" } },
    ];
    const result = await createOrder(FORM);
    expect(result).toMatchObject({ ok: false });
  });
});

describe("併發雙送出（uq_orders_one_pending_per_cart 碰撞，T76／0011）", () => {
  it("搶輸 → 導去贏家付款頁，不觸發 order_no 換號重試", async () => {
    state.rpcResults = [
      {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "uq_orders_one_pending_per_cart"',
        },
      },
    ];
    state.racedOrder = { order_no: "INC-WINNER-1" };

    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    expect(redirect).toHaveBeenCalledWith("/checkout/pay?order=INC-WINNER-1");
    expect(rpcCalls()).toHaveLength(1);
  });

  it("搶輸但重查也撲空 → 回通用建單失敗錯誤、不 redirect", async () => {
    state.rpcResults = [
      {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "uq_orders_one_pending_per_cart"',
        },
      },
    ];
    state.racedOrder = null;

    const result = await createOrder(FORM);

    expect(result).toMatchObject({ ok: false });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("重查本身出錯 → 回通用建單失敗錯誤、不 redirect（§6 SDK 錯誤回傳必檢查）", async () => {
    state.rpcResults = [
      {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "uq_orders_one_pending_per_cart"',
        },
      },
    ];
    state.racedOrder = { order_no: "INC-WINNER-1" };
    state.racedOrderError = { message: "connection timeout" };

    const result = await createOrder(FORM);

    expect(result).toMatchObject({ ok: false });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("交易化與清車（T76／T75）", () => {
  it("RPC 整體失敗（非 23505，例如 order_item FK 違反已整段 rollback）→ 回建單失敗錯誤、不 redirect", async () => {
    state.rpcResults = [{ data: null, error: { message: "boom" } }];
    const result = await createOrder(FORM);
    expect(result).toMatchObject({ ok: false });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("orders.cart_id FK 違反（23503，cart 在讀取後被刪除）→ 回明確錯誤，不重試", async () => {
    state.rpcResults = [{ data: null, error: { code: "23503" } }];
    const result = await createOrder(FORM);
    expect(result).toMatchObject({
      ok: false,
      error: "購物車已過期，請重新整理購物車後再試一次",
    });
    expect(rpcCalls()).toHaveLength(1);
  });

  it("成功路徑 → 呼叫 create_order_with_items 並帶正確 cart_id 與品項快照、redirect；不主動清購物車（T75：付款成功才清）", async () => {
    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    const call = rpcCalls()[0]!;
    expect(call).toBeTruthy();
    expect(call.values.p_cart_id).toBe("cart-1");
    expect(call.values.p_items[0]).toMatchObject({
      product_name_snapshot: "祖母綠戒指",
      unit_price_snapshot: 25000,
    });
    expect(deletes).not.toContain("cart");
  });

  it("同一張 cart 已有 pending 訂單且 cart 沒被再動過 → 直接導去該訂單付款頁，不重複建單", async () => {
    // cart.updated_at (07-10) <= 訂單 created_at (07-11)：內容沒變，重複送出
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-EXISTING-1",
      created_at: "2026-07-11T00:00:00+00:00",
    };

    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    expect(redirect).toHaveBeenCalledWith("/checkout/pay?order=INC-EXISTING-1");
    expect(transitionOrder).not.toHaveBeenCalled();
    expect(rpcCalls()).toHaveLength(0);
  });

  it("同一張 cart 已有 pending 訂單但 cart 之後被改過 → 取消舊單、建新單（不能讓客人付到舊金額）", async () => {
    // cart.updated_at (07-10) > 訂單 created_at (07-09)：下單後又動過購物車
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-EXISTING-1",
      created_at: "2026-07-09T00:00:00+00:00",
    };

    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    expect(transitionOrder).toHaveBeenCalledWith(
      "order-old",
      "cancelled",
      expect.objectContaining({ note: expect.any(String) }),
    );
    expect(rpcCalls()).toHaveLength(1); // 建了新訂單
    expect(redirect).toHaveBeenCalledWith(
      expect.stringMatching(/^\/checkout\/pay\?order=INC-/),
    );
  });

  it("取消舊單時搶輸（剛好被 webhook 轉 paid）→ 導去舊單付款頁（該頁會轉成功頁），不建新單", async () => {
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-EXISTING-1",
      created_at: "2026-07-09T00:00:00+00:00",
    };
    transitionOrder.mockRejectedValue(
      new OrderTransitionRaceError("已被其他流程異動"),
    );

    await expect(createOrder(FORM)).rejects.toBe(REDIRECT);

    expect(redirect).toHaveBeenCalledWith("/checkout/pay?order=INC-EXISTING-1");
    expect(rpcCalls()).toHaveLength(0);
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

    expect(result).toMatchObject({
      ok: false,
      error: "請求太頻繁，請稍後再試",
    });
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
    const call = rpcCalls()[0]!;
    expect(call.values.p_member_id).toBe("member-new");
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
