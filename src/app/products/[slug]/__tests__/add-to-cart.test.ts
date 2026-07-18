/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// next/headers mock：cookieJar 讀取，set() 記錄呼叫供斷言；headers() 固定回傳無 IP
// （IP 限流有獨立的 login/actions 測試涵蓋，這裡只需要 guest_token 限流路徑）
let cookieJar: Record<string, string> = {};
const cookieSetCalls: { name: string; value: string }[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar[name] !== undefined ? { value: cookieJar[name] } : undefined,
    set: (name: string, value: string) => {
      cookieSetCalls.push({ name, value });
      cookieJar[name] = value;
    },
  }),
  headers: async () => ({
    get: () => null,
  }),
}));

// T78 限流 mock：預設一律放行，個別測試可覆寫 success 值
vi.mock("@/lib/rate-limit", () => ({
  checkCartWriteRateLimit: async () => state.tokenRateLimitSuccess,
}));

// 一般 client：商品／選項讀取，固定回傳一個非必填單選項的商品
const state = {
  product: { id: "prod-1", base_price: 25000, status: "active" } as any,
  productOptions: [
    {
      id: "opt-1",
      required: false,
      option_type: { code: "size", name: "尺寸" },
      product_option_value: [
        {
          id: "val-1",
          price_delta: 0,
          option_value: { code: "s", label: "S" },
        },
      ],
    },
  ] as any[],
  // cart insert 每次呼叫的回傳（依序消耗）
  cartInsertResults: [] as { data: any; error: any }[],
  // maybeSingle 每次呼叫的回傳，依序消耗：第一次是 read-first 的初始查詢，
  // 若 insert 撞 23505 則第二次是 reselect。預設查無資料（觸發 insert 路徑）
  cartSelectResults: [] as { data: any; error: any }[],
  maybeSingleCalls: 0,
  cartItemInsertError: null as any,
  // T78：guest_token 限流 mock 開關；cart.update（touch）回傳的 error
  tokenRateLimitSuccess: true,
  cartTouchError: null as any,
  // T81：登入身分——null＝訪客（走 guest 分支，多數既有測試）；非 null＝
  // 走 member 分支（getOrCreateMemberCart）
  authUser: null as any,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser }, error: null }),
    },
    from: (table: string) => {
      if (table === "product") {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          single: () => Promise.resolve({ data: state.product }),
        };
        return chain;
      }
      if (table === "product_option") {
        const chain: any = {
          select: () => chain,
          eq: () => Promise.resolve({ data: state.productOptions }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

type Insert = { table: string; values: any };
const recorded: Insert[] = [];

function cartChain() {
  const chain: any = {
    insert: (values: any) => {
      recorded.push({ table: "cart", values });
      return chain;
    },
    // touchCartUpdatedAt 呼叫的 .update({...}).eq("id", cartId)：獨立回傳
    // thenable，不共用 chain 的 eq（那支是給 insert/select 用的）
    update: (values: any) => ({
      eq: (_col: string, id: string) => {
        recorded.push({ table: "cart_touch", values: { id, ...values } });
        return Promise.resolve({ error: state.cartTouchError });
      },
    }),
    select: () => chain,
    eq: () => chain,
    single: () =>
      Promise.resolve(
        state.cartInsertResults.shift() ?? {
          data: { id: "cart-1" },
          error: null,
        },
      ),
    maybeSingle: () => {
      state.maybeSingleCalls += 1;
      return Promise.resolve(
        state.cartSelectResults.shift() ?? { data: null, error: null },
      );
    },
  };
  return chain;
}

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table === "cart") return cartChain();
      if (table === "cart_item") {
        const chain: any = {
          insert: (values: any) => {
            recorded.push({ table: "cart_item", values });
            return Promise.resolve({ error: state.cartItemInsertError });
          },
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => makeServiceRole(),
}));

import { addToCart } from "../actions";

const INPUT = {
  productId: "prod-1",
  productOptionValueIds: [] as string[],
  quantity: 1,
};

beforeEach(() => {
  recorded.length = 0;
  cookieSetCalls.length = 0;
  cookieJar = {};
  state.cartInsertResults = [];
  state.cartSelectResults = [];
  state.maybeSingleCalls = 0;
  state.cartItemInsertError = null;
  state.tokenRateLimitSuccess = true;
  state.cartTouchError = null;
  state.authUser = null;
});

describe("addToCart — cart get-or-create（T130 read-first）", () => {
  it("read-first 命中既有 cart → 直接沿用、不 insert", async () => {
    cookieJar = { guest_token: "guest-abc" };
    state.cartSelectResults = [{ data: { id: "cart-existing" }, error: null }];

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: true });
    const cartItemInsert = recorded.find((r) => r.table === "cart_item");
    expect(cartItemInsert?.values.cart_id).toBe("cart-existing");
    expect(recorded.find((r) => r.table === "cart")).toBeUndefined();
    expect(state.maybeSingleCalls).toBe(1);
  });

  it("read-first 初始查詢本身出錯 → ok:false, error:系統忙碌，請稍後再試", async () => {
    cookieJar = { guest_token: "guest-abc" };
    state.cartSelectResults = [{ data: null, error: { message: "boom" } }];

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: false, error: "系統忙碌，請稍後再試" });
    expect(recorded.find((r) => r.table === "cart")).toBeUndefined();
  });

  it("全新 guest_token → read-first 查無資料 → insert 一次成功 → cart_item 用回傳的 id → ok:true、cookie 有 set", async () => {
    state.cartInsertResults = [{ data: { id: "cart-new" }, error: null }];

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: true });
    const cartItemInsert = recorded.find((r) => r.table === "cart_item");
    expect(cartItemInsert?.values.cart_id).toBe("cart-new");
    expect(cookieSetCalls).toHaveLength(1);
    expect(cookieSetCalls[0]?.name).toBe("guest_token");
    expect(state.maybeSingleCalls).toBe(1);
  });

  it("併發 guest_token（read-first 落空後 insert 撞 23505）→ reselect 取回既有 cart → cart_item 正確寫入 → ok:true", async () => {
    cookieJar = { guest_token: "guest-abc" };
    state.cartInsertResults = [{ data: null, error: { code: "23505" } }];
    state.cartSelectResults = [
      { data: null, error: null },
      { data: { id: "cart-existing" }, error: null },
    ];

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: true });
    const cartItemInsert = recorded.find((r) => r.table === "cart_item");
    expect(cartItemInsert?.values.cart_id).toBe("cart-existing");
    expect(state.maybeSingleCalls).toBe(2);
  });

  it("23505 後 reselect 查無資料 → ok:false, error:建立購物車失敗", async () => {
    state.cartInsertResults = [{ data: null, error: { code: "23505" } }];
    state.cartSelectResults = [
      { data: null, error: null },
      { data: null, error: null },
    ];

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: false, error: "建立購物車失敗" });
  });

  it("23505 後 reselect 本身出錯 → ok:false, error:建立購物車失敗", async () => {
    state.cartInsertResults = [{ data: null, error: { code: "23505" } }];
    state.cartSelectResults = [
      { data: null, error: null },
      { data: null, error: { message: "boom" } },
    ];

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: false, error: "建立購物車失敗" });
  });

  it("非 23505 的 insert 錯誤 → ok:false, error:建立購物車失敗，且不觸發 reselect", async () => {
    state.cartInsertResults = [{ data: null, error: { code: "23503" } }];

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: false, error: "建立購物車失敗" });
    expect(state.maybeSingleCalls).toBe(1);
  });

  it("cart_item insert 失敗（新 cart）→ ok:false、不 set cookie", async () => {
    state.cartInsertResults = [{ data: { id: "cart-new" }, error: null }];
    state.cartItemInsertError = { message: "boom" };

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: false, error: "加入購物車失敗，請再試一次" });
    expect(cookieSetCalls).toHaveLength(0);
  });

  it("cart_item insert 失敗（23505 reselect 後的 cart）→ ok:false、不 set cookie", async () => {
    state.cartInsertResults = [{ data: null, error: { code: "23505" } }];
    state.cartSelectResults = [
      { data: null, error: null },
      { data: { id: "cart-existing" }, error: null },
    ];
    state.cartItemInsertError = { message: "boom" };

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: false, error: "加入購物車失敗，請再試一次" });
    expect(cookieSetCalls).toHaveLength(0);
  });

  it("全新 guest_token → 成功加車後 touch 該 cart 的 updated_at", async () => {
    state.cartInsertResults = [{ data: { id: "cart-new" }, error: null }];

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: true });
    const touch = recorded.find((r) => r.table === "cart_touch");
    expect(touch?.values.id).toBe("cart-new");
  });

  // T81：登入者加車走 member 分支——getOrCreateMemberCart 命中既有會員車、
  // 品項寫進該車、且**不簽/不續 guest cookie**（getOrCreateMemberCart 的完整
  // 併發分支另在 get-or-create-member-cart.test.ts 覆蓋）。
  it("登入態加車 → 走 member 分支、cart_item 進會員車、不 set guest cookie", async () => {
    state.authUser = { id: "mem-1", email: "m@example.com" };
    cookieJar = { guest_token: "guest-abc" }; // 即使帶著 guest cookie 也不理會
    state.cartSelectResults = [{ data: { id: "cart-mem" }, error: null }];

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: true });
    const cartItemInsert = recorded.find((r) => r.table === "cart_item");
    expect(cartItemInsert?.values.cart_id).toBe("cart-mem");
    expect(cookieSetCalls).toHaveLength(0);
  });
});

describe("addToCart — T78 限流與 cart.updated_at touch", () => {
  it("guest_token 限流超限 → ok:false、不寫入 cart_item", async () => {
    cookieJar = { guest_token: "guest-abc" };
    state.tokenRateLimitSuccess = false;

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: false, error: "操作過於頻繁，請稍後再試" });
    expect(recorded.find((r) => r.table === "cart_item")).toBeUndefined();
  });

  it("touch（cart.update）失敗不影響已成功的加車操作", async () => {
    state.cartInsertResults = [{ data: { id: "cart-new" }, error: null }];
    state.cartSelectResults = [{ data: null, error: null }];
    state.cartTouchError = { message: "boom" };

    const result = await addToCart(INPUT);

    expect(result).toEqual({ ok: true });
    expect(cookieSetCalls).toHaveLength(1);
  });
});
