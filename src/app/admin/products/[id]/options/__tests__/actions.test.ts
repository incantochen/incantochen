/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));

const requireAdmin = vi.fn().mockResolvedValue({ email: "admin@example.com" });
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
}));

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const OPTION_TYPE_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_OPTION_ID = "33333333-3333-4333-8333-333333333333";
const OPTION_VALUE_ID = "44444444-4444-4444-8444-444444444444";
const POV_ID = "55555555-5555-4555-8555-555555555555";

type MockError = { code?: string; message?: string } | null;

const state = {
  product: { category: "ring" } as { category: string } | null,
  productError: null as MockError,
  optionType: { applies_to: "ring", is_active: true } as {
    applies_to: string;
    is_active: boolean;
  } | null,
  optionTypeError: null as MockError,
  // insert_product_option / move_product_option / set_default RPC
  rpcResult: null as unknown,
  rpcError: null as MockError,
  // product_option lookups
  productOptionRow: { option_type_id: OPTION_TYPE_ID, product_id: PRODUCT_ID } as {
    option_type_id: string;
    product_id: string;
  } | null,
  productOptionUpdateRows: [{ product_id: PRODUCT_ID }] as
    | { product_id: string }[]
    | null,
  productOptionUpdateError: null as MockError,
  productOptionDeleteRow: { product_id: PRODUCT_ID } as {
    product_id: string;
  } | null,
  productOptionDeleteError: null as MockError,
  productIdOfOptionRow: { product_id: PRODUCT_ID } as {
    product_id: string;
  } | null,
  // option_value lookup (cross-type guard)
  optionValueRow: { option_type_id: OPTION_TYPE_ID } as {
    option_type_id: string;
  } | null,
  optionValueError: null as MockError,
  // product_option_value insert / update / delete
  povInsertRow: { id: POV_ID } as { id: string } | null,
  povInsertError: null as MockError,
  povUpdateRows: [{ product_option_id: PRODUCT_OPTION_ID }] as
    | { product_option_id: string }[]
    | null,
  povUpdateError: null as MockError,
  povRow: { product_option_id: PRODUCT_OPTION_ID } as {
    product_option_id: string;
  } | null,
  povRowError: null as MockError,
  povDeleteRow: { product_option_id: PRODUCT_OPTION_ID } as {
    product_option_id: string;
  } | null,
  povDeleteError: null as MockError,
  povClearRow: { product_option_id: PRODUCT_OPTION_ID } as {
    product_option_id: string;
  } | null,
};

const recorded: {
  op: string;
  table: string;
  values?: any;
  eqs: [string, unknown][];
}[] = [];
const rpcCalls: { fn: string; args: any }[] = [];

function updates(table: string) {
  return recorded.filter((r) => r.op === "update" && r.table === table);
}
function inserts(table: string) {
  return recorded.filter((r) => r.op === "insert" && r.table === table);
}

// select("slug, category") → revalidateForProduct 用；用一個旗標區分它跟其他
// product 查詢（category-only）。這裡以 cols 內容分辨。
function productSelectResult(cols: string) {
  if (cols.includes("slug")) {
    return { data: { slug: "test-slug", category: "ring" }, error: null };
  }
  return { data: state.product, error: state.productError };
}

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: state.rpcResult, error: state.rpcError });
    },
    from: (table: string) => {
      if (table === "product") {
        return {
          select: (cols: string) => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(productSelectResult(cols)),
            }),
          }),
        };
      }
      if (table === "option_type") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: state.optionType,
                  error: state.optionTypeError,
                }),
            }),
          }),
        };
      }
      if (table === "option_value") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: state.optionValueRow,
                  error: state.optionValueError,
                }),
            }),
          }),
        };
      }
      if (table === "product_option") {
        return {
          select: (cols: string) => ({
            eq: () => ({
              maybeSingle: () => {
                // productIdOfOption 用 select("product_id")；addProductOptionValue
                // 的 guard 用 select("option_type_id, product_id")
                if (cols === "product_id") {
                  return Promise.resolve({
                    data: state.productIdOfOptionRow,
                    error: null,
                  });
                }
                return Promise.resolve({
                  data: state.productOptionRow,
                  error: null,
                });
              },
            }),
          }),
          update: (values: any) => {
            const entry = {
              op: "update",
              table,
              values,
              eqs: [] as [string, unknown][],
            };
            recorded.push(entry);
            const chain: any = {
              eq: (col: string, val: unknown) => {
                entry.eqs.push([col, val]);
                return chain;
              },
              select: () =>
                Promise.resolve({
                  data: state.productOptionUpdateError
                    ? null
                    : state.productOptionUpdateRows,
                  error: state.productOptionUpdateError,
                }),
            };
            return chain;
          },
          delete: () => {
            const entry = {
              op: "delete",
              table,
              eqs: [] as [string, unknown][],
            };
            recorded.push(entry);
            const chain: any = {
              eq: (col: string, val: unknown) => {
                entry.eqs.push([col, val]);
                return chain;
              },
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: state.productOptionDeleteError
                      ? null
                      : state.productOptionDeleteRow,
                    error: state.productOptionDeleteError,
                  }),
              }),
            };
            return chain;
          },
        };
      }
      // product_option_value
      return {
        insert: (values: any) => {
          recorded.push({ op: "insert", table, values, eqs: [] });
          return {
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: state.povInsertError ? null : state.povInsertRow,
                  error: state.povInsertError,
                }),
            }),
          };
        },
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: state.povRowError ? null : state.povRow,
                error: state.povRowError,
              }),
          }),
        }),
        update: (values: any) => {
          const entry = {
            op: "update",
            table,
            values,
            eqs: [] as [string, unknown][],
          };
          recorded.push(entry);
          const hasUpdatedAtGuard = false;
          const chain: any = {
            eq: (col: string, val: unknown) => {
              entry.eqs.push([col, val]);
              return chain;
            },
            // price update 用 .select() 回陣列（CAS）；clearDefault 用
            // .select().maybeSingle()。用 values 內容區分。
            select: () => {
              if ("is_default" in values) {
                return {
                  maybeSingle: () =>
                    Promise.resolve({ data: state.povClearRow, error: null }),
                };
              }
              return Promise.resolve({
                data: state.povUpdateError ? null : state.povUpdateRows,
                error: state.povUpdateError,
              });
            },
          };
          void hasUpdatedAtGuard;
          return chain;
        },
        delete: () => {
          const entry = {
            op: "delete",
            table,
            eqs: [] as [string, unknown][],
          };
          recorded.push(entry);
          const chain: any = {
            eq: (col: string, val: unknown) => {
              entry.eqs.push([col, val]);
              return chain;
            },
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: state.povDeleteError ? null : state.povDeleteRow,
                  error: state.povDeleteError,
                }),
            }),
          };
          return chain;
        },
      };
    },
  }),
}));

import {
  addProductOption,
  updateProductOptionRequired,
  moveProductOption,
  removeProductOption,
  addProductOptionValue,
  updateProductOptionValuePrice,
  setDefaultProductOptionValue,
  clearDefaultProductOptionValue,
  removeProductOptionValue,
} from "../actions";

beforeEach(() => {
  recorded.length = 0;
  rpcCalls.length = 0;
  revalidatePath.mockClear();
  state.product = { category: "ring" };
  state.productError = null;
  state.optionType = { applies_to: "ring", is_active: true };
  state.optionTypeError = null;
  state.rpcResult = null;
  state.rpcError = null;
  state.productOptionRow = {
    option_type_id: OPTION_TYPE_ID,
    product_id: PRODUCT_ID,
  };
  state.productOptionUpdateRows = [{ product_id: PRODUCT_ID }];
  state.productOptionUpdateError = null;
  state.productOptionDeleteRow = { product_id: PRODUCT_ID };
  state.productOptionDeleteError = null;
  state.productIdOfOptionRow = { product_id: PRODUCT_ID };
  state.optionValueRow = { option_type_id: OPTION_TYPE_ID };
  state.optionValueError = null;
  state.povInsertRow = { id: POV_ID };
  state.povInsertError = null;
  state.povUpdateRows = [{ product_option_id: PRODUCT_OPTION_ID }];
  state.povUpdateError = null;
  state.povRow = { product_option_id: PRODUCT_OPTION_ID };
  state.povRowError = null;
  state.povDeleteRow = { product_option_id: PRODUCT_OPTION_ID };
  state.povDeleteError = null;
  state.povClearRow = { product_option_id: PRODUCT_OPTION_ID };
});

describe("addProductOption", () => {
  it("成功走 insert_product_option RPC 並帶對參數", async () => {
    state.rpcResult = "new-po-id";
    const result = await addProductOption(PRODUCT_ID, OPTION_TYPE_ID, true);
    expect(result).toEqual({ ok: true, id: "new-po-id" });
    expect(rpcCalls[0]).toEqual({
      fn: "insert_product_option",
      args: {
        p_product_id: PRODUCT_ID,
        p_option_type_id: OPTION_TYPE_ID,
        p_required: true,
      },
    });
  });

  it("applies_to 越界（型別不適用本品類）被拒，不打 RPC", async () => {
    state.optionType = { applies_to: "earring", is_active: true };
    const result = await addProductOption(PRODUCT_ID, OPTION_TYPE_ID, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("不適用");
    expect(rpcCalls).toHaveLength(0);
  });

  it("applies_to='all' 的型別任何品類都可加", async () => {
    state.optionType = { applies_to: "all", is_active: true };
    state.rpcResult = "new-po-id";
    const result = await addProductOption(PRODUCT_ID, OPTION_TYPE_ID, false);
    expect(result.ok).toBe(true);
  });

  it("隱藏中的型別被拒", async () => {
    state.optionType = { applies_to: "ring", is_active: false };
    const result = await addProductOption(PRODUCT_ID, OPTION_TYPE_ID, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("隱藏");
    expect(rpcCalls).toHaveLength(0);
  });

  it("同型別已加過（23505）回友善訊息", async () => {
    state.rpcError = { code: "23505" };
    const result = await addProductOption(PRODUCT_ID, OPTION_TYPE_ID, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("已加入過");
  });
});

describe("updateProductOptionRequired", () => {
  it("CAS 帶 updated_at，成功回 ok", async () => {
    const result = await updateProductOptionRequired(PRODUCT_OPTION_ID, false, {
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    const update = updates("product_option")[0];
    expect(update?.values).toEqual({ required: false });
    expect(update?.eqs).toContainEqual(["updated_at", "2026-01-01T00:00:00Z"]);
  });

  it("0 列命中（並發）回 RACE_MESSAGE", async () => {
    state.productOptionUpdateRows = [];
    const result = await updateProductOptionRequired(PRODUCT_OPTION_ID, false, {
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("已被其他管理員異動");
  });
});

describe("moveProductOption", () => {
  it("走 RPC 並用呼叫端 productId revalidate", async () => {
    state.rpcResult = "moved";
    const result = await moveProductOption(PRODUCT_OPTION_ID, PRODUCT_ID, "up");
    expect(result.ok).toBe(true);
    expect(rpcCalls[0]).toEqual({
      fn: "move_product_option",
      args: { p_product_option_id: PRODUCT_OPTION_ID, p_direction: "up" },
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/admin/products/${PRODUCT_ID}/options`,
    );
  });

  it("not_found 回友善訊息", async () => {
    state.rpcResult = "not_found";
    const result = await moveProductOption(PRODUCT_OPTION_ID, PRODUCT_ID, "up");
    expect(result.ok).toBe(false);
  });

  it("edge 視為成功", async () => {
    state.rpcResult = "edge";
    const result = await moveProductOption(
      PRODUCT_OPTION_ID,
      PRODUCT_ID,
      "down",
    );
    expect(result.ok).toBe(true);
  });
});

describe("removeProductOption", () => {
  it("刪除成功回 ok", async () => {
    const result = await removeProductOption(PRODUCT_OPTION_ID);
    expect(result.ok).toBe(true);
    expect(recorded.some((r) => r.op === "delete" && r.table === "product_option")).toBe(true);
  });

  it("找不到列回友善訊息", async () => {
    state.productOptionDeleteRow = null;
    const result = await removeProductOption(PRODUCT_OPTION_ID);
    expect(result.ok).toBe(false);
  });
});

describe("addProductOptionValue", () => {
  it("成功：以 is_default=false 插入，設預設走 RPC", async () => {
    const result = await addProductOptionValue(
      PRODUCT_OPTION_ID,
      OPTION_VALUE_ID,
      "2000",
      true,
    );
    expect(result).toEqual({ ok: true, id: POV_ID });
    const insert = inserts("product_option_value")[0];
    expect(insert?.values).toMatchObject({
      price_delta: 2000,
      is_default: false,
    });
    expect(rpcCalls.some((c) => c.fn === "set_default_product_option_value")).toBe(true);
  });

  it("isDefault=false 時不呼叫 set_default RPC", async () => {
    await addProductOptionValue(PRODUCT_OPTION_ID, OPTION_VALUE_ID, "0", false);
    expect(rpcCalls.some((c) => c.fn === "set_default_product_option_value")).toBe(false);
  });

  it("跨型別塞值被拒", async () => {
    state.optionValueRow = { option_type_id: "99999999-9999-4999-8999-999999999999" };
    const result = await addProductOptionValue(
      PRODUCT_OPTION_ID,
      OPTION_VALUE_ID,
      "0",
      false,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("不屬於");
    expect(inserts("product_option_value")).toHaveLength(0);
  });

  it("priceDelta 負數被拒", async () => {
    const result = await addProductOptionValue(
      PRODUCT_OPTION_ID,
      OPTION_VALUE_ID,
      "-100",
      false,
    );
    expect(result.ok).toBe(false);
    expect(inserts("product_option_value")).toHaveLength(0);
  });

  it("priceDelta 小數被拒", async () => {
    const result = await addProductOptionValue(
      PRODUCT_OPTION_ID,
      OPTION_VALUE_ID,
      "10.5",
      false,
    );
    expect(result.ok).toBe(false);
  });

  it("已加入白名單（23505）回友善訊息", async () => {
    state.povInsertError = { code: "23505" };
    const result = await addProductOptionValue(
      PRODUCT_OPTION_ID,
      OPTION_VALUE_ID,
      "0",
      false,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("已加入白名單");
  });
});

describe("updateProductOptionValuePrice", () => {
  it("CAS 帶 updated_at，成功", async () => {
    const result = await updateProductOptionValuePrice(POV_ID, "3000", {
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    const update = updates("product_option_value")[0];
    expect(update?.values).toEqual({ price_delta: 3000 });
    expect(update?.eqs).toContainEqual(["updated_at", "2026-01-01T00:00:00Z"]);
  });

  it("0 列命中回 RACE_MESSAGE", async () => {
    state.povUpdateRows = [];
    const result = await updateProductOptionValuePrice(POV_ID, "3000", {
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("已被其他管理員異動");
  });

  it("負數被拒", async () => {
    const result = await updateProductOptionValuePrice(POV_ID, "-1", {
      updatedAt: "x",
    });
    expect(result.ok).toBe(false);
  });
});

describe("setDefaultProductOptionValue", () => {
  it("走 RPC 原子切換，回 ok", async () => {
    state.rpcResult = 3;
    const result = await setDefaultProductOptionValue(POV_ID);
    expect(result.ok).toBe(true);
    expect(rpcCalls.some((c) => c.fn === "set_default_product_option_value")).toBe(true);
  });

  it("pov 不存在（RPC 回 0）回友善訊息", async () => {
    state.rpcResult = 0;
    const result = await setDefaultProductOptionValue(POV_ID);
    expect(result.ok).toBe(false);
  });

  it("查無 pov（前置查詢）不打 RPC", async () => {
    state.povRow = null;
    const result = await setDefaultProductOptionValue(POV_ID);
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("clearDefaultProductOptionValue", () => {
  it("單列 update is_default=false", async () => {
    const result = await clearDefaultProductOptionValue(POV_ID);
    expect(result.ok).toBe(true);
    expect(updates("product_option_value")[0]?.values).toEqual({
      is_default: false,
    });
  });
});

describe("removeProductOptionValue", () => {
  it("刪除成功回 ok", async () => {
    const result = await removeProductOptionValue(POV_ID);
    expect(result.ok).toBe(true);
  });

  it("找不到列回友善訊息", async () => {
    state.povDeleteRow = null;
    const result = await removeProductOptionValue(POV_ID);
    expect(result.ok).toBe(false);
  });
});
