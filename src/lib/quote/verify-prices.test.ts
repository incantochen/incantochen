/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect } from "vitest";
import type { Json } from "@/types/database.types";

vi.mock("server-only", () => ({}));

import { verifyCartPrices } from "./verify-prices";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type MockProductOption = {
  required?: boolean;
  option_type: { code: string; name?: string; is_active?: boolean };
  product_option_value: Array<{
    price_delta: unknown;
    option_value: { code: string; label: string; is_active?: boolean };
  }>;
};

// T12 後 verifyCartPrices 會讀 is_active／required／option_type.name——
// 既有 fixture 未指定時補預設值，明確傳入的測試案例維持原值
function withActiveDefaults(
  productOptions: MockProductOption[] | null,
): MockProductOption[] | null {
  if (!productOptions) return productOptions;
  return productOptions.map((po) => ({
    required: po.required ?? false,
    option_type: { is_active: true, name: "測試選項", ...po.option_type },
    product_option_value: po.product_option_value.map((pov) => ({
      ...pov,
      option_value: { is_active: true, ...pov.option_value },
    })),
  }));
}

function buildMock(
  product: { base_price: unknown; name?: unknown } | null,
  productOptions: MockProductOption[] | null,
) {
  // 未指定 name 時給預設值（T65 後 verifyCartPrices 會驗證 name）；明確傳入者優先
  const productData = product ? { name: "測試商品", ...product } : null;
  const optionsData = withActiveDefaults(productOptions);
  const productChain: any = {
    select: () => productChain,
    eq: () => productChain,
    maybeSingle: () => Promise.resolve({ data: productData }),
  };
  const productOptionsChain: any = {
    select: () => productOptionsChain,
    eq: () => Promise.resolve({ data: optionsData }),
  };
  return {
    from: (table: string) =>
      table === "product" ? productChain : productOptionsChain,
  } as any;
}

// Stateful mock: product returns different data per call
function buildCallCountMock(
  products: ({ base_price: number } | null)[],
  productOptions: MockProductOption[],
) {
  let callCount = 0;
  const productChain: any = {
    select: () => productChain,
    eq: () => productChain,
    maybeSingle: () => {
      const p = products[callCount++] ?? null;
      return Promise.resolve({ data: p ? { name: "測試商品", ...p } : null });
    },
  };
  const optionsData = withActiveDefaults(productOptions);
  const productOptionsChain: any = {
    select: () => productOptionsChain,
    eq: () => Promise.resolve({ data: optionsData }),
  };
  return {
    from: (table: string) =>
      table === "product" ? productChain : productOptionsChain,
  } as any;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT_ID = "00000000-0000-4000-8000-000000000001";

const GEM_OPTIONS: MockProductOption[] = [
  {
    option_type: { code: "gem_color" },
    product_option_value: [
      { price_delta: 3000, option_value: { code: "emerald", label: "翠綠" } },
    ],
  },
];

const GEM_RING_OPTIONS: MockProductOption[] = [
  {
    option_type: { code: "gem_color" },
    product_option_value: [
      { price_delta: 3000, option_value: { code: "emerald", label: "翠綠" } },
    ],
  },
  {
    option_type: { code: "ring_size" },
    product_option_value: [
      { price_delta: 500, option_value: { code: "size-10", label: "10號" } },
    ],
  },
];

function makeItem(
  overrides: Partial<{
    id: string;
    unit_price_snapshot: number;
    selections: {
      option_type_code: string;
      option_value_code: string;
      label: string;
      price_delta: unknown;
    }[];
    config_snapshot: Json;
  }> = {},
) {
  const selections = overrides.selections ?? [
    {
      option_type_code: "gem_color",
      option_value_code: "emerald",
      label: "翠綠",
      price_delta: 3000,
    },
  ];
  return {
    id: overrides.id ?? "item-1",
    product_id: PRODUCT_ID,
    quantity: 1,
    unit_price_snapshot: overrides.unit_price_snapshot ?? 13000,
    config_snapshot: (overrides.config_snapshot ?? {
      product_id: PRODUCT_ID,
      base_price: 10000,
      selections,
      line_unit_price: 13000,
    }) as Json,
  };
}

// ---------------------------------------------------------------------------
// A — Core
// ---------------------------------------------------------------------------

describe("A Core", () => {
  it("A1: empty cartItems returns []", async () => {
    const result = await verifyCartPrices(buildMock(null, null), []);
    expect(result).toEqual([]);
  });

  it("A2: price same → priceChanged false", async () => {
    const mock = buildMock({ base_price: 10000 }, GEM_OPTIONS);
    const [item] = await verifyCartPrices(mock, [makeItem()]);
    expect(item?.priceChanged).toBe(false);
    expect(item?.verifiedUnitPrice).toBe(13000);
  });

  it("A3: price different (price_delta changed) → priceChanged true", async () => {
    const changedOptions: MockProductOption[] = [
      {
        option_type: { code: "gem_color" },
        product_option_value: [
          {
            price_delta: 5000,
            option_value: { code: "emerald", label: "翠綠" },
          },
        ],
      },
    ];
    const mock = buildMock({ base_price: 10000 }, changedOptions);
    const [item] = await verifyCartPrices(mock, [makeItem()]);
    expect(item?.priceChanged).toBe(true);
    expect(item?.verifiedUnitPrice).toBe(15000);
  });

  it("A4: verifiedUnitPrice = base_price + Σ price_delta", async () => {
    const mock = buildMock({ base_price: 10000 }, GEM_RING_OPTIONS);
    const cartItem = makeItem({
      unit_price_snapshot: 13500,
      selections: [
        {
          option_type_code: "gem_color",
          option_value_code: "emerald",
          label: "翠綠",
          price_delta: 3000,
        },
        {
          option_type_code: "ring_size",
          option_value_code: "size-10",
          label: "10號",
          price_delta: 500,
        },
      ],
      config_snapshot: {
        product_id: PRODUCT_ID,
        base_price: 10000,
        selections: [
          {
            option_type_code: "gem_color",
            option_value_code: "emerald",
            label: "翠綠",
            price_delta: 3000,
          },
          {
            option_type_code: "ring_size",
            option_value_code: "size-10",
            label: "10號",
            price_delta: 500,
          },
        ],
        line_unit_price: 13500,
      },
    });
    const [item] = await verifyCartPrices(mock, [cartItem]);
    expect(item?.verifiedUnitPrice).toBe(13500);
    expect(item?.priceChanged).toBe(false);
  });

  it("A5: empty selections → verifiedUnitPrice = base_price only", async () => {
    const mock = buildMock({ base_price: 10000 }, []);
    const cartItem = makeItem({
      unit_price_snapshot: 10000,
      selections: [],
      config_snapshot: {
        product_id: PRODUCT_ID,
        base_price: 10000,
        selections: [],
        line_unit_price: 10000,
      },
    });
    const [item] = await verifyCartPrices(mock, [cartItem]);
    expect(item?.verifiedUnitPrice).toBe(10000);
    expect(item?.priceChanged).toBe(false);
  });

  it("A6: malformed config_snapshot → throw", async () => {
    const cartItem = makeItem({ config_snapshot: { bad: "data" } });
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, GEM_OPTIONS), [
        cartItem,
      ]),
    ).rejects.toThrow("購物車項目設定損壞");
  });

  it("A7: product null (inactive/missing) → throw", async () => {
    await expect(
      verifyCartPrices(buildMock(null, GEM_OPTIONS), [makeItem()]),
    ).rejects.toThrow("商品已下架");
  });

  it("A8: productOptions null → throw", async () => {
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, null), [makeItem()]),
    ).rejects.toThrow("無法取得商品選項");
  });

  it("A9: option_type not in whitelist → throw", async () => {
    const cartItem = makeItem({
      selections: [
        {
          option_type_code: "unknown_type",
          option_value_code: "emerald",
          label: "?",
          price_delta: 3000,
        },
      ],
      config_snapshot: {
        product_id: PRODUCT_ID,
        base_price: 10000,
        selections: [
          {
            option_type_code: "unknown_type",
            option_value_code: "emerald",
            label: "?",
            price_delta: 3000,
          },
        ],
        line_unit_price: 13000,
      },
    });
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, GEM_OPTIONS), [
        cartItem,
      ]),
    ).rejects.toThrow("不在此商品白名單");
  });

  it("A10: option_value not in whitelist → throw", async () => {
    const cartItem = makeItem({
      selections: [
        {
          option_type_code: "gem_color",
          option_value_code: "ruby",
          label: "紅寶",
          price_delta: 3000,
        },
      ],
      config_snapshot: {
        product_id: PRODUCT_ID,
        base_price: 10000,
        selections: [
          {
            option_type_code: "gem_color",
            option_value_code: "ruby",
            label: "紅寶",
            price_delta: 3000,
          },
        ],
        line_unit_price: 13000,
      },
    });
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, GEM_OPTIONS), [
        cartItem,
      ]),
    ).rejects.toThrow("不在此商品白名單");
  });

  it("A11: second item product null → throw mid-loop", async () => {
    const mock = buildCallCountMock([{ base_price: 10000 }, null], GEM_OPTIONS);
    const item2 = makeItem({ id: "item-2" });
    await expect(verifyCartPrices(mock, [makeItem(), item2])).rejects.toThrow(
      "商品已下架",
    );
  });

  // T12：is_active=false 的隱藏項目不進白名單（service role 不受 RLS 過濾，
  // 應用層排除）——購物車還帶著隱藏項目時走既有「不在白名單」錯誤路徑
  it("A12: hidden option_value (is_active=false) → not in whitelist → throw", async () => {
    const hiddenValueOptions: MockProductOption[] = [
      {
        option_type: { code: "gem_color" },
        product_option_value: [
          {
            price_delta: 3000,
            option_value: { code: "emerald", label: "翠綠", is_active: false },
          },
        ],
      },
    ];
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, hiddenValueOptions), [
        makeItem(),
      ]),
    ).rejects.toThrow("不在此商品白名單");
  });

  it("A13: hidden option_type (is_active=false) → whole type not in whitelist → throw", async () => {
    const hiddenTypeOptions: MockProductOption[] = [
      {
        option_type: { code: "gem_color", is_active: false },
        product_option_value: [
          {
            price_delta: 3000,
            option_value: { code: "emerald", label: "翠綠" },
          },
        ],
      },
    ];
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, hiddenTypeOptions), [
        makeItem(),
      ]),
    ).rejects.toThrow("不在此商品白名單");
  });

  it("A15: required type without a selection in config → throw（防缺規格訂單）", async () => {
    const requiredOptions: MockProductOption[] = [
      {
        option_type: { code: "gem_color" },
        product_option_value: [
          {
            price_delta: 3000,
            option_value: { code: "emerald", label: "翠綠" },
          },
        ],
      },
      {
        required: true,
        option_type: { code: "ring_size", name: "戒圍" },
        product_option_value: [
          {
            price_delta: 0,
            option_value: { code: "size-10", label: "10號" },
          },
        ],
      },
    ];
    // config 只帶 gem_color，缺必選 ring_size
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, requiredOptions), [
        makeItem(),
      ]),
    ).rejects.toThrow("必選項目「戒圍」缺少選擇");
  });

  it("A16: hidden required type still enforced（隱藏期間加車的缺規格項目要擋）", async () => {
    const hiddenRequiredOptions: MockProductOption[] = [
      {
        required: true,
        option_type: { code: "ring_size", name: "戒圍", is_active: false },
        product_option_value: [
          {
            price_delta: 0,
            option_value: { code: "size-10", label: "10號" },
          },
        ],
      },
    ];
    const noSelectionItem = makeItem({
      selections: [],
      unit_price_snapshot: 10000,
      config_snapshot: {
        product_id: PRODUCT_ID,
        base_price: 10000,
        selections: [],
        line_unit_price: 10000,
      },
    });
    await expect(
      verifyCartPrices(
        buildMock({ base_price: 10000 }, hiddenRequiredOptions),
        [noSelectionItem],
      ),
    ).rejects.toThrow("必選項目「戒圍」缺少選擇");
  });

  it("A14: hidden value on another type does not affect active selection", async () => {
    const mixedOptions: MockProductOption[] = [
      {
        option_type: { code: "gem_color" },
        product_option_value: [
          {
            price_delta: 3000,
            option_value: { code: "emerald", label: "翠綠" },
          },
          {
            price_delta: 9000,
            option_value: { code: "ruby", label: "紅寶", is_active: false },
          },
        ],
      },
    ];
    const result = await verifyCartPrices(
      buildMock({ base_price: 10000 }, mixedOptions),
      [makeItem()],
    );
    expect(result[0]?.verifiedUnitPrice).toBe(13000);
    expect(result[0]?.priceChanged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B — Numeric injection
// ---------------------------------------------------------------------------

describe("B Numeric", () => {
  it("B12: NaN price_delta in config_snapshot → Zod catch → throw", async () => {
    const cartItem = makeItem({
      config_snapshot: {
        product_id: PRODUCT_ID,
        base_price: 10000,
        selections: [
          {
            option_type_code: "gem_color",
            option_value_code: "emerald",
            label: "翠綠",
            price_delta: NaN,
          },
        ],
        line_unit_price: NaN,
      },
    });
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, GEM_OPTIONS), [
        cartItem,
      ]),
    ).rejects.toThrow("購物車項目設定損壞");
  });

  it("B13: DB price_delta null → throw", async () => {
    const options = [
      {
        option_type: { code: "gem_color" },
        product_option_value: [
          {
            price_delta: null,
            option_value: { code: "emerald", label: "翠綠" },
          },
        ],
      },
    ];
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, options as any), [
        makeItem(),
      ]),
    ).rejects.toThrow("選項定價資料異常");
  });

  it("B14: DB price_delta string → throw", async () => {
    const options = [
      {
        option_type: { code: "gem_color" },
        product_option_value: [
          {
            price_delta: "3000",
            option_value: { code: "emerald", label: "翠綠" },
          },
        ],
      },
    ];
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, options as any), [
        makeItem(),
      ]),
    ).rejects.toThrow("選項定價資料異常");
  });

  it("B15: Infinity price_delta in config_snapshot → z.number().finite() → throw", async () => {
    const cartItem = makeItem({
      config_snapshot: {
        product_id: PRODUCT_ID,
        base_price: 10000,
        selections: [
          {
            option_type_code: "gem_color",
            option_value_code: "emerald",
            label: "翠綠",
            price_delta: Infinity,
          },
        ],
        line_unit_price: Infinity,
      },
    });
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, GEM_OPTIONS), [
        cartItem,
      ]),
    ).rejects.toThrow("購物車項目設定損壞");
  });
});

// ---------------------------------------------------------------------------
// C — Tamper
// ---------------------------------------------------------------------------

describe("C Tamper", () => {
  it("C16: tampered unit_price_snapshot ignored, DB price wins", async () => {
    const cartItem = makeItem({ unit_price_snapshot: 999 }); // tampered client value
    const [item] = await verifyCartPrices(
      buildMock({ base_price: 10000 }, GEM_OPTIONS),
      [cartItem],
    );
    expect(item?.verifiedUnitPrice).toBe(13000);
    expect(item?.priceChanged).toBe(true);
  });

  it("C17: config_snapshot price_delta mismatch with DB → priceChanged true, DB value wins", async () => {
    // snapshot says delta=3000, DB says delta=5000
    const changedOptions: MockProductOption[] = [
      {
        option_type: { code: "gem_color" },
        product_option_value: [
          {
            price_delta: 5000,
            option_value: { code: "emerald", label: "翠綠" },
          },
        ],
      },
    ];
    const [item] = await verifyCartPrices(
      buildMock({ base_price: 10000 }, changedOptions),
      [makeItem()],
    );
    expect(item?.verifiedUnitPrice).toBe(15000);
    expect(item?.priceChanged).toBe(true);
  });

  it("C18: deleted product replay (status inactive) → throw", async () => {
    // .eq("status","active") returns null for inactive products
    await expect(
      verifyCartPrices(buildMock(null, GEM_OPTIONS), [makeItem()]),
    ).rejects.toThrow("商品已下架");
  });
});

// ---------------------------------------------------------------------------
// D — Precision
// ---------------------------------------------------------------------------

describe("D Precision", () => {
  it("D19: floating point sum has no precision drift", async () => {
    // 1000 + 100.1 + 200.2 = 1300.2999... in raw JS; with round → 1300.3
    const options: MockProductOption[] = [
      {
        option_type: { code: "gem_color" },
        product_option_value: [
          {
            price_delta: 100.1,
            option_value: { code: "emerald", label: "翠綠" },
          },
        ],
      },
      {
        option_type: { code: "ring_size" },
        product_option_value: [
          {
            price_delta: 200.2,
            option_value: { code: "size-10", label: "10號" },
          },
        ],
      },
    ];
    const cartItem = makeItem({
      unit_price_snapshot: 1300.3,
      config_snapshot: {
        product_id: PRODUCT_ID,
        base_price: 1000,
        selections: [
          {
            option_type_code: "gem_color",
            option_value_code: "emerald",
            label: "翠綠",
            price_delta: 100.1,
          },
          {
            option_type_code: "ring_size",
            option_value_code: "size-10",
            label: "10號",
            price_delta: 200.2,
          },
        ],
        line_unit_price: 1300.3,
      },
    });
    const [item] = await verifyCartPrices(
      buildMock({ base_price: 1000 }, options),
      [cartItem],
    );
    expect(item?.verifiedUnitPrice).toBe(1300.3);
    expect(item?.priceChanged).toBe(false);
  });

  it("D20: rounding is deterministic across two independent calls", async () => {
    const r1 = await verifyCartPrices(
      buildMock({ base_price: 10000 }, GEM_OPTIONS),
      [makeItem()],
    );
    const r2 = await verifyCartPrices(
      buildMock({ base_price: 10000 }, GEM_OPTIONS),
      [makeItem()],
    );
    expect(r1[0]?.verifiedUnitPrice).toBe(r2[0]?.verifiedUnitPrice);
    expect(r1[0]?.priceChanged).toBe(r2[0]?.priceChanged);
  });
});

// ---------------------------------------------------------------------------
// E — Cart edge cases
// ---------------------------------------------------------------------------

describe("E Cart", () => {
  it("E21: duplicate items verified independently, each returned", async () => {
    const item2 = makeItem({ id: "item-2", unit_price_snapshot: 13000 });
    const result = await verifyCartPrices(
      buildMock({ base_price: 10000 }, GEM_OPTIONS),
      [makeItem(), item2],
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.cartItemId).toBe("item-1");
    expect(result[1]?.cartItemId).toBe("item-2");
    expect(result[0]?.verifiedUnitPrice).toBe(result[1]?.verifiedUnitPrice);
  });

  it("E22: selections in different order produce same total", async () => {
    const itemAB = makeItem({
      id: "item-ab",
      unit_price_snapshot: 13500,
      config_snapshot: {
        product_id: PRODUCT_ID,
        base_price: 10000,
        selections: [
          {
            option_type_code: "gem_color",
            option_value_code: "emerald",
            label: "翠綠",
            price_delta: 3000,
          },
          {
            option_type_code: "ring_size",
            option_value_code: "size-10",
            label: "10號",
            price_delta: 500,
          },
        ],
        line_unit_price: 13500,
      },
    });
    const itemBA = makeItem({
      id: "item-ba",
      unit_price_snapshot: 13500,
      config_snapshot: {
        product_id: PRODUCT_ID,
        base_price: 10000,
        selections: [
          {
            option_type_code: "ring_size",
            option_value_code: "size-10",
            label: "10號",
            price_delta: 500,
          },
          {
            option_type_code: "gem_color",
            option_value_code: "emerald",
            label: "翠綠",
            price_delta: 3000,
          },
        ],
        line_unit_price: 13500,
      },
    });
    const result = await verifyCartPrices(
      buildMock({ base_price: 10000 }, GEM_RING_OPTIONS),
      [itemAB, itemBA],
    );
    expect(result[0]?.verifiedUnitPrice).toBe(13500);
    expect(result[1]?.verifiedUnitPrice).toBe(13500);
    expect(result[0]?.priceChanged).toBe(false);
    expect(result[1]?.priceChanged).toBe(false);
  });

  it("E23: snapshot label mismatch ignored — rebuilt configSnapshot uses DB label", async () => {
    const cartItem = makeItem({
      config_snapshot: {
        product_id: PRODUCT_ID,
        base_price: 10000,
        selections: [
          {
            option_type_code: "gem_color",
            option_value_code: "emerald",
            label: "WRONG LABEL",
            price_delta: 3000,
          },
        ],
        line_unit_price: 13000,
      },
    });
    const [item] = await verifyCartPrices(
      buildMock({ base_price: 10000 }, GEM_OPTIONS),
      [cartItem],
    );
    const snap = item?.configSnapshot as any;
    expect(snap.selections[0].label).toBe("翠綠");
    expect(item?.verifiedUnitPrice).toBe(13000);
  });
});

// ---------------------------------------------------------------------------
// F — Abuse
// ---------------------------------------------------------------------------

describe("F Abuse", () => {
  it("F24: DB price_delta undefined → throw", async () => {
    const options = [
      {
        option_type: { code: "gem_color" },
        product_option_value: [
          {
            price_delta: undefined,
            option_value: { code: "emerald", label: "翠綠" },
          },
        ],
      },
    ];
    await expect(
      verifyCartPrices(buildMock({ base_price: 10000 }, options as any), [
        makeItem(),
      ]),
    ).rejects.toThrow("選項定價資料異常");
  });

  it("F25: negative verifiedUnitPrice → throw", async () => {
    const negOptions: MockProductOption[] = [
      {
        option_type: { code: "gem_color" },
        product_option_value: [
          {
            price_delta: -99999,
            option_value: { code: "emerald", label: "翠綠" },
          },
        ],
      },
    ];
    await expect(
      verifyCartPrices(buildMock({ base_price: 100 }, negOptions), [
        makeItem(),
      ]),
    ).rejects.toThrow("定價不得為負數");
  });

  it("F26: 50-item cart does not crash", async () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `item-${i}` }),
    );
    const result = await verifyCartPrices(
      buildMock({ base_price: 10000 }, GEM_OPTIONS),
      items,
    );
    expect(result).toHaveLength(50);
    expect(result.every((r) => r.verifiedUnitPrice === 13000)).toBe(true);
  }, 10000);
});

// ---------------------------------------------------------------------------
// G — Determinism
// ---------------------------------------------------------------------------

describe("G Determinism", () => {
  it("G27: same input always produces identical output", async () => {
    const run = () =>
      verifyCartPrices(buildMock({ base_price: 10000 }, GEM_OPTIONS), [
        makeItem(),
      ]);
    const [r1, r2, r3] = await Promise.all([run(), run(), run()]);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });
});

// ---------------------------------------------------------------------------
// H — Product name snapshot (T65)
// ---------------------------------------------------------------------------

describe("H Product name", () => {
  it("H28: productName returns current DB name", async () => {
    const mock = buildMock(
      { base_price: 10000, name: "祖母綠單鑽戒指" },
      GEM_OPTIONS,
    );
    const [item] = await verifyCartPrices(mock, [makeItem()]);
    expect(item?.productName).toBe("祖母綠單鑽戒指");
  });

  it("H29: DB name null → throw", async () => {
    const mock = buildMock({ base_price: 10000, name: null }, GEM_OPTIONS);
    await expect(verifyCartPrices(mock, [makeItem()])).rejects.toThrow(
      "商品名稱資料異常",
    );
  });

  it("H30: DB name empty/whitespace string → throw", async () => {
    const mock = buildMock({ base_price: 10000, name: "  " }, GEM_OPTIONS);
    await expect(verifyCartPrices(mock, [makeItem()])).rejects.toThrow(
      "商品名稱資料異常",
    );
  });

  it("H31: DB name non-string (number) → throw", async () => {
    const mock = buildMock({ base_price: 10000, name: 123 }, GEM_OPTIONS);
    await expect(verifyCartPrices(mock, [makeItem()])).rejects.toThrow(
      "商品名稱資料異常",
    );
  });
});
