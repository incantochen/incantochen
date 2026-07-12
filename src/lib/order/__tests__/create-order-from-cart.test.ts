/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));

const verifyCartPrices = vi.fn();
vi.mock("@/lib/quote/verify-prices", () => ({
  verifyCartPrices: (...a: unknown[]) => verifyCartPrices(...a),
}));

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

import {
  createOrderFromCart,
  resolvePendingOrderForCart,
} from "../create-order-from-cart";

// ---------------------------------------------------------------------------
// Fixtures / mock service role
// ---------------------------------------------------------------------------

type Recorded = { table: string; values: any };
const recorded: Recorded[] = [];

const state = {
  cartItems: [
    {
      id: "ci-1",
      product_id: "11111111-1111-4111-8111-111111111111",
      quantity: 1,
      unit_price_snapshot: 25000,
      config_snapshot: {},
    },
  ] as any[],
  existingPendingOrder: null as {
    id: string;
    order_no: string;
    created_at: string;
    member_id: string;
    recipient_name: string;
    recipient_phone: string;
    zip_code: string;
    shipping_address: string;
  } | null,
  dedupError: null as { message?: string } | null,
  racedOrder: null as { order_no: string } | null,
  racedOrderError: null as { message?: string } | null,
  rpcResults: [] as { data: any; error: any }[],
  // 記錄 racedOrder 重查鏈上呼叫過的 eq 條件（驗證 member_id 過濾）
  ordersEqFilters: [] as [string, unknown][][],
};

const RECIPIENT = {
  recipientName: "王小明",
  recipientPhone: "0912345678",
  zipCode: "106",
  shippingAddress: "台北市大安區測試路 1 號",
};

// existingPendingOrder 的收件欄位對齊 RECIPIENT，模擬「內容完全沒變」；
// 個別測試若要模擬「收件資訊變了」則覆寫這幾個欄位。
const SAME_RECIPIENT_ROW = {
  recipient_name: RECIPIENT.recipientName,
  recipient_phone: RECIPIENT.recipientPhone,
  zip_code: RECIPIENT.zipCode,
  shipping_address: RECIPIENT.shippingAddress,
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

function rpcCalls() {
  return recorded.filter((r) => r.table === "rpc:create_order_with_items");
}

function makeServiceRole() {
  // "orders" 表有兩種語意不同的查詢：resolvePendingOrderForCart 的 dedup
  // 預檢查（select 含 created_at/member_id）與 createOrderFromCart 內
  // collision fallback 的 racedOrder 重查（只 select order_no）。依 select
  // 欄位分流，不依呼叫次數（dedup 已移出 createOrderFromCart，次數不再固定）。
  return {
    rpc: (name: string, params: any) => {
      recorded.push({ table: `rpc:${name}`, values: params });
      return Promise.resolve(
        state.rpcResults.shift() ?? { data: { id: "order-1" }, error: null },
      );
    },
    from: (table: string) => {
      const eqFilters: [string, unknown][] = [];
      let selectedCols = "";
      const chain: any = {
        select: (cols?: string) => {
          selectedCols = cols ?? "";
          return chain;
        },
        eq: (col: string, val: unknown) => {
          eqFilters.push([col, val]);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          if (table === "orders") {
            state.ordersEqFilters.push(eqFilters);
            if (selectedCols.includes("created_at")) {
              return Promise.resolve({
                data: state.existingPendingOrder,
                error: state.dedupError,
              });
            }
            return Promise.resolve({
              data: state.racedOrder,
              error: state.racedOrderError,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        update: (values: any) => {
          recorded.push({ table, values });
          return chain;
        },
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      };
      return chain;
    },
  } as any;
}

beforeEach(() => {
  recorded.length = 0;
  state.cartItems = [
    {
      id: "ci-1",
      product_id: "11111111-1111-4111-8111-111111111111",
      quantity: 1,
      unit_price_snapshot: 25000,
      config_snapshot: {},
    },
  ];
  state.existingPendingOrder = null;
  state.dedupError = null;
  state.racedOrder = null;
  state.racedOrderError = null;
  state.rpcResults = [];
  state.ordersEqFilters = [];
  transitionOrder.mockReset();
  transitionOrder.mockResolvedValue(undefined);
  verifyCartPrices.mockReset();
  verifyCartPrices.mockResolvedValue(VERIFIED_OK);
  revalidatePath.mockClear();
});

function callCreateOrderFromCart() {
  return createOrderFromCart(
    makeServiceRole(),
    "cart-1",
    state.cartItems,
    "member-1",
    RECIPIENT,
  );
}

// ---------------------------------------------------------------------------
// resolvePendingOrderForCart（T75 dedup，F1/F2 修正後獨立成呼叫端前置步驟）
// ---------------------------------------------------------------------------

describe("resolvePendingOrderForCart", () => {
  it("無既有 pending 訂單 → proceed", async () => {
    const result = await resolvePendingOrderForCart(
      makeServiceRole(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      RECIPIENT,
    );
    expect(result).toEqual({ kind: "proceed" });
  });

  it("cart 沒被再動過、收件資訊也沒變 → reuse 既有訂單號，不呼叫 transitionOrder", async () => {
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-EXISTING-1",
      created_at: "2026-07-11T00:00:00+00:00",
      member_id: "member-1",
      ...SAME_RECIPIENT_ROW,
    };

    // cart.updated_at (07-10) <= 訂單 created_at (07-11)：內容沒變
    const result = await resolvePendingOrderForCart(
      makeServiceRole(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      RECIPIENT,
    );

    expect(result).toEqual({ kind: "reuse", orderNo: "INC-EXISTING-1" });
    expect(transitionOrder).not.toHaveBeenCalled();
  });

  it("收件地址跟舊單不同（如 admin 改錯字重送）→ 即使 cart 與 member 都沒變也取消重建，不沿用舊地址", async () => {
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-EXISTING-1",
      created_at: "2026-07-11T00:00:00+00:00",
      member_id: "member-1",
      recipient_name: RECIPIENT.recipientName,
      recipient_phone: RECIPIENT.recipientPhone,
      zip_code: RECIPIENT.zipCode,
      shipping_address: "台北市大安區舊地址 999 號", // 跟 RECIPIENT 不同
    };

    const result = await resolvePendingOrderForCart(
      makeServiceRole(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      RECIPIENT,
    );

    expect(transitionOrder).toHaveBeenCalledWith(
      "order-old",
      "cancelled",
      expect.objectContaining({ note: expect.any(String) }),
    );
    expect(result).toEqual({ kind: "proceed" });
  });

  it("不帶 memberId（客人流程）→ 不比對 member，仍 reuse", async () => {
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-EXISTING-1",
      created_at: "2026-07-11T00:00:00+00:00",
      member_id: "member-someone",
      ...SAME_RECIPIENT_ROW,
    };

    const result = await resolvePendingOrderForCart(
      makeServiceRole(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      RECIPIENT,
    );

    expect(result).toEqual({ kind: "reuse", orderNo: "INC-EXISTING-1" });
  });

  it("cart 之後被改過 → 取消舊單、proceed（不能讓客人付到舊金額）", async () => {
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-EXISTING-1",
      created_at: "2026-07-09T00:00:00+00:00",
      member_id: "member-1",
      ...SAME_RECIPIENT_ROW,
    };

    // cart.updated_at (07-10) > 訂單 created_at (07-09)：下單後又動過購物車
    const result = await resolvePendingOrderForCart(
      makeServiceRole(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      RECIPIENT,
    );

    expect(transitionOrder).toHaveBeenCalledWith(
      "order-old",
      "cancelled",
      expect.objectContaining({ note: expect.any(String) }),
    );
    expect(result).toEqual({ kind: "proceed" });
  });

  it("帶 memberId 且與舊單 member 不同（admin 改 email 重送）→ 即使 cart 沒變也取消舊單重建，絕不沿用錯誤客戶的單", async () => {
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-WRONG-MEMBER",
      created_at: "2026-07-11T00:00:00+00:00",
      member_id: "member-typo",
      ...SAME_RECIPIENT_ROW,
    };

    // cart 沒變（07-10 <= 07-11），但 member 不同 → 仍要取消重建
    const result = await resolvePendingOrderForCart(
      makeServiceRole(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      RECIPIENT,
      "member-correct",
    );

    expect(transitionOrder).toHaveBeenCalledWith(
      "order-old",
      "cancelled",
      expect.objectContaining({ note: expect.any(String) }),
    );
    expect(result).toEqual({ kind: "proceed" });
  });

  it("帶 memberId 且與舊單 member 相同、cart 與收件資訊都沒變 → reuse", async () => {
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-EXISTING-1",
      created_at: "2026-07-11T00:00:00+00:00",
      member_id: "member-1",
      ...SAME_RECIPIENT_ROW,
    };

    const result = await resolvePendingOrderForCart(
      makeServiceRole(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      RECIPIENT,
      "member-1",
    );

    expect(result).toEqual({ kind: "reuse", orderNo: "INC-EXISTING-1" });
  });

  it("取消舊單時搶輸（剛好被 webhook 轉 paid）且同 member、收件資訊也沒變 → reuse 舊單號", async () => {
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-EXISTING-1",
      created_at: "2026-07-09T00:00:00+00:00",
      member_id: "member-1",
      ...SAME_RECIPIENT_ROW,
    };
    transitionOrder.mockRejectedValue(
      new OrderTransitionRaceError("已被其他流程異動"),
    );

    const result = await resolvePendingOrderForCart(
      makeServiceRole(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      RECIPIENT,
    );

    expect(result).toEqual({ kind: "reuse", orderNo: "INC-EXISTING-1" });
  });

  it("取消舊單時搶輸但 member 不同 → error（不能把別人的單交出去）", async () => {
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-WRONG-MEMBER",
      created_at: "2026-07-11T00:00:00+00:00",
      member_id: "member-typo",
      ...SAME_RECIPIENT_ROW,
    };
    transitionOrder.mockRejectedValue(
      new OrderTransitionRaceError("已被其他流程異動"),
    );

    const result = await resolvePendingOrderForCart(
      makeServiceRole(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      RECIPIENT,
      "member-correct",
    );

    expect(result).toMatchObject({ kind: "error" });
  });

  it("取消舊單失敗（非 race）→ error", async () => {
    state.existingPendingOrder = {
      id: "order-old",
      order_no: "INC-EXISTING-1",
      created_at: "2026-07-09T00:00:00+00:00",
      member_id: "member-1",
      ...SAME_RECIPIENT_ROW,
    };
    transitionOrder.mockRejectedValue(new Error("db down"));

    const result = await resolvePendingOrderForCart(
      makeServiceRole(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      RECIPIENT,
    );

    expect(result).toMatchObject({ kind: "error" });
  });

  it("dedup 查詢本身出錯 → fail-closed 回 error（§6）", async () => {
    state.dedupError = { message: "connection timeout" };

    const result = await resolvePendingOrderForCart(
      makeServiceRole(),
      "cart-1",
      "2026-07-10T00:00:00+00:00",
      RECIPIENT,
    );

    expect(result).toMatchObject({ kind: "error" });
  });
});

// ---------------------------------------------------------------------------
// createOrderFromCart（驗價＋建單核心；dedup 已移出）
// ---------------------------------------------------------------------------

describe("伺服器端驗價（T41 紅線）", () => {
  it("驗價金額有變 → 更新 cart_item 快照、revalidate、回 priceUpdated、不建單", async () => {
    verifyCartPrices.mockResolvedValue([
      { ...VERIFIED_OK[0], verifiedUnitPrice: 26000, priceChanged: true },
    ]);

    const result = await callCreateOrderFromCart();

    expect(result).toMatchObject({ ok: false, priceUpdated: true });
    const cartItemUpdate = recorded.find((r) => r.table === "cart_item");
    expect(cartItemUpdate?.values.unit_price_snapshot).toBe(26000);
    expect(revalidatePath).toHaveBeenCalledWith("/cart");
    expect(rpcCalls()).toHaveLength(0);
  });

  it("驗價拋錯（商品下架）→ 回錯誤、不建單", async () => {
    verifyCartPrices.mockRejectedValue(new Error("商品已下架"));
    const result = await callCreateOrderFromCart();
    expect(result).toMatchObject({ ok: false, error: "商品已下架" });
    expect(rpcCalls()).toHaveLength(0);
  });

  it("訂單金額採驗證後價格，非 cart 快照價", async () => {
    state.cartItems = [{ ...state.cartItems[0], unit_price_snapshot: 1 }];

    await callCreateOrderFromCart();

    const call = rpcCalls()[0]!;
    expect(call.values.p_subtotal).toBe(25000);
    expect(call.values.p_total_amount).toBe(25000);
    expect(call.values.p_items[0].unit_price_snapshot).toBe(25000);
  });
});

describe("order_no 碰撞重試", () => {
  it("首次 23505 → 換號重試一次成功", async () => {
    state.rpcResults = [
      { data: null, error: { code: "23505" } },
      { data: { id: "order-2" }, error: null },
    ];

    const result = await callCreateOrderFromCart();

    expect(rpcCalls()).toHaveLength(2);
    const [first, second] = rpcCalls();
    expect(first!.values.p_order_no).not.toBe(second!.values.p_order_no);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.orderNo).toMatch(/^INC-/);
    }
  });

  it("重試仍失敗 → 回建單失敗錯誤", async () => {
    state.rpcResults = [
      { data: null, error: { code: "23505" } },
      { data: null, error: { code: "23505" } },
    ];
    const result = await callCreateOrderFromCart();
    expect(result).toMatchObject({ ok: false });
  });
});

describe("併發雙送出（uq_orders_one_pending_per_cart 碰撞，T76／0011）", () => {
  const COLLISION_RPC = {
    data: null,
    error: {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "uq_orders_one_pending_per_cart"',
    },
  };

  it("搶輸 → 沿用贏家單號，不觸發 order_no 換號重試", async () => {
    state.rpcResults = [COLLISION_RPC];
    state.racedOrder = { order_no: "INC-WINNER-1" };

    const result = await callCreateOrderFromCart();

    expect(result).toMatchObject({ ok: true, orderNo: "INC-WINNER-1" });
    expect(rpcCalls()).toHaveLength(1);
  });

  it("racedOrder 重查帶 member_id 過濾（admin 換 email 併發時不能把別人的單交出去）", async () => {
    state.rpcResults = [COLLISION_RPC];
    state.racedOrder = { order_no: "INC-WINNER-1" };

    await callCreateOrderFromCart();

    // 唯一一次 orders 查詢就是 collision fallback 的重查
    const filters = state.ordersEqFilters[0]!;
    expect(filters).toContainEqual(["member_id", "member-1"]);
  });

  it("搶輸但重查也撲空 → 回通用建單失敗錯誤", async () => {
    state.rpcResults = [COLLISION_RPC];
    state.racedOrder = null;

    const result = await callCreateOrderFromCart();

    expect(result).toMatchObject({ ok: false });
  });

  it("重查本身出錯 → 回通用建單失敗錯誤（§6 SDK 錯誤回傳必檢查）", async () => {
    state.rpcResults = [COLLISION_RPC];
    state.racedOrder = { order_no: "INC-WINNER-1" };
    state.racedOrderError = { message: "connection timeout" };

    const result = await callCreateOrderFromCart();

    expect(result).toMatchObject({ ok: false });
  });
});

describe("交易化與清車（T76／T75）", () => {
  it("RPC 整體失敗（非 23505，例如 order_item FK 違反已整段 rollback）→ 回建單失敗錯誤", async () => {
    state.rpcResults = [{ data: null, error: { message: "boom" } }];
    const result = await callCreateOrderFromCart();
    expect(result).toMatchObject({ ok: false });
  });

  it("orders.cart_id FK 違反（23503，cart 在讀取後被刪除）→ 回明確錯誤，不重試", async () => {
    state.rpcResults = [{ data: null, error: { code: "23503" } }];
    const result = await callCreateOrderFromCart();
    expect(result).toMatchObject({
      ok: false,
      error: "購物車已過期，請重新整理購物車後再試一次",
    });
    expect(rpcCalls()).toHaveLength(1);
  });

  it("成功路徑 → 呼叫 create_order_with_items 並帶正確 cart_id 與品項快照", async () => {
    const result = await callCreateOrderFromCart();

    expect(result).toMatchObject({ ok: true });
    const call = rpcCalls()[0]!;
    expect(call).toBeTruthy();
    expect(call.values.p_cart_id).toBe("cart-1");
    expect(call.values.p_member_id).toBe("member-1");
    expect(call.values.p_items[0]).toMatchObject({
      product_name_snapshot: "祖母綠戒指",
      unit_price_snapshot: 25000,
    });
  });
});
