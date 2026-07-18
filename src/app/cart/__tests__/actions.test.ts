/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const revalidatePath = vi.fn();
let cookieJar: Record<string, string> = {};
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

// T78 限流 mock：預設一律放行，個別測試可覆寫 success 值
const state = {
  tokenRateLimitSuccess: true,
  ipRateLimitSuccess: true,
  cartItem: {
    id: "item-1",
    cart_id: "cart-1",
    cart: { member_id: null, guest_token: "guest-abc" },
  } as any,
  cartItemMutationError: null as any,
  cartTouchError: null as any,
  cartItemSelectError: null as any,
  // T81：登入身分——null＝訪客（比 guest_token），非 null＝比 member_id
  authUser: null as any,
};
vi.mock("@/lib/rate-limit", () => ({
  checkCartWriteRateLimit: async () =>
    state.tokenRateLimitSuccess && state.ipRateLimitSuccess,
}));

// T81：resolveCartIdentity 呼叫 createClient().auth.getUser() 判身分。
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser }, error: null }),
    },
  }),
}));

type Recorded = { table: string; op: string; values?: any };
const recorded: Recorded[] = [];

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "cart_item") {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: state.cartItem,
              error: state.cartItemSelectError,
            }),
          update: (values: any) => {
            recorded.push({ table: "cart_item", op: "update", values });
            return {
              eq: () => Promise.resolve({ error: state.cartItemMutationError }),
            };
          },
          delete: () => {
            recorded.push({ table: "cart_item", op: "delete" });
            return {
              eq: () => Promise.resolve({ error: state.cartItemMutationError }),
            };
          },
        };
        return chain;
      }
      if (table === "cart") {
        return {
          update: (values: any) => ({
            eq: (_col: string, id: string) => {
              recorded.push({
                table: "cart_touch",
                op: "update",
                values: { id, ...values },
              });
              return Promise.resolve({ error: state.cartTouchError });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { updateCartItemQuantity, removeCartItem } from "../actions";

beforeEach(() => {
  recorded.length = 0;
  revalidatePath.mockClear();
  cookieJar = { guest_token: "guest-abc" };
  state.tokenRateLimitSuccess = true;
  state.ipRateLimitSuccess = true;
  state.cartItem = {
    id: "item-1",
    cart_id: "cart-1",
    cart: { member_id: null, guest_token: "guest-abc" },
  };
  state.cartItemMutationError = null;
  state.cartTouchError = null;
  state.cartItemSelectError = null;
  state.authUser = null;
});

describe("cart actions — ownership／限流／cart.updated_at touch（T78）", () => {
  it("無 guest_token cookie → ok:false、找不到購物車", async () => {
    cookieJar = {};

    const result = await updateCartItemQuantity("item-1", 2);

    expect(result).toEqual({ ok: false, error: "找不到購物車" });
  });

  it("guest_token 不相符 → ok:false、找不到此購物車項目", async () => {
    state.cartItem = {
      id: "item-1",
      cart_id: "cart-1",
      cart: { guest_token: "someone-else" },
    };

    const result = await removeCartItem("item-1");

    expect(result).toEqual({ ok: false, error: "找不到此購物車項目" });
  });

  it("cart_item 查詢出錯（非查無資料）→ ok:false、查詢購物車失敗，不誤判為找不到項目", async () => {
    state.cartItemSelectError = { message: "connection timeout" };

    const result = await updateCartItemQuantity("item-1", 2);

    expect(result).toEqual({ ok: false, error: "查詢購物車失敗，請再試一次" });
    expect(
      recorded.find((r) => r.op === "update" && r.table === "cart_item"),
    ).toBeUndefined();
  });

  it("限流超限 → ok:false、不執行 mutation", async () => {
    state.tokenRateLimitSuccess = false;

    const result = await updateCartItemQuantity("item-1", 2);

    expect(result).toEqual({ ok: false, error: "操作過於頻繁，請稍後再試" });
    expect(
      recorded.find((r) => r.op === "update" && r.table === "cart_item"),
    ).toBeUndefined();
  });

  it("updateCartItemQuantity 成功 → touch 對應 cart 的 updated_at", async () => {
    const result = await updateCartItemQuantity("item-1", 2);

    expect(result).toEqual({ ok: true });
    const touch = recorded.find((r) => r.table === "cart_touch");
    expect(touch?.values.id).toBe("cart-1");
    expect(revalidatePath).toHaveBeenCalledWith("/cart");
  });

  it("removeCartItem 成功 → touch 對應 cart 的 updated_at", async () => {
    const result = await removeCartItem("item-1");

    expect(result).toEqual({ ok: true });
    const touch = recorded.find((r) => r.table === "cart_touch");
    expect(touch?.values.id).toBe("cart-1");
  });

  it("touch（cart.update）失敗不影響已成功的 updateCartItemQuantity", async () => {
    state.cartTouchError = { message: "boom" };

    const result = await updateCartItemQuantity("item-1", 2);

    expect(result).toEqual({ ok: true });
  });

  it("touch（cart.update）失敗不影響已成功的 removeCartItem", async () => {
    state.cartTouchError = { message: "boom" };

    const result = await removeCartItem("item-1");

    expect(result).toEqual({ ok: true });
  });

  // T81：登入者依 member_id 核對擁有權，不看 guest_token。
  it("登入者操作自己 member 車的項目 → 通過（比 member_id、不看 guest_token）", async () => {
    state.authUser = { id: "mem-1" };
    cookieJar = {}; // 登入態不需要 guest cookie
    state.cartItem = {
      id: "item-1",
      cart_id: "cart-1",
      cart: { member_id: "mem-1", guest_token: null },
    };

    const result = await updateCartItemQuantity("item-1", 2);

    expect(result).toEqual({ ok: true });
    const touch = recorded.find((r) => r.table === "cart_touch");
    expect(touch?.values.id).toBe("cart-1");
  });

  it("登入者操作他人 member 車的項目 → 拒絕", async () => {
    state.authUser = { id: "mem-1" };
    state.cartItem = {
      id: "item-1",
      cart_id: "cart-1",
      cart: { member_id: "mem-2", guest_token: null },
    };

    const result = await removeCartItem("item-1");

    expect(result).toEqual({ ok: false, error: "找不到此購物車項目" });
  });
});
