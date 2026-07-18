/* eslint-disable @typescript-eslint/no-explicit-any */
// T81：getOrCreateMemberCart——會員車寫入路徑的單一出處。三步：命中直回、
// claim fallback、確保 member row（孤兒 auth user 守衛）後 INSERT 撞 23505 重查。
import { vi, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const findOrCreateMember = vi.fn();
vi.mock("@/lib/auth/find-or-create-member", () => ({
  findOrCreateMember: (...a: unknown[]) => findOrCreateMember(...a),
}));

const claimGuestCartForMember = vi.fn();
vi.mock("@/lib/cart/merge-guest-cart", () => ({
  claimGuestCartForMember: (...a: unknown[]) => claimGuestCartForMember(...a),
}));

type Res = { data: any; error: any };
const state = {
  memberCartResults: [] as Res[], // selectMemberCartId 依序消耗
  insertResult: { data: null, error: null } as Res, // cart insert .single()
};
const recorded: { op: string; values?: any }[] = [];

function makeServiceRole() {
  return {
    from() {
      const chain: any = {
        select: () => chain,
        insert: (values: any) => {
          recorded.push({ op: "insert", values });
          return chain;
        },
        eq: () => chain,
        single: async () => state.insertResult,
        maybeSingle: async () =>
          state.memberCartResults.shift() ?? { data: null, error: null },
      };
      return chain;
    },
  };
}

import { getOrCreateMemberCart } from "../get-or-create-member-cart";

const SR = makeServiceRole() as any;

beforeEach(() => {
  findOrCreateMember.mockClear();
  findOrCreateMember.mockResolvedValue(undefined);
  claimGuestCartForMember.mockReset();
  state.memberCartResults = [];
  state.insertResult = { data: null, error: null };
  recorded.length = 0;
});

it("① 命中會員車 → 直回，不 claim、不 insert", async () => {
  state.memberCartResults = [{ data: { id: "cart-m" }, error: null }];

  const r = await getOrCreateMemberCart(SR, "mem-1", "m@x.com", "tok-1");

  expect(r).toEqual({ ok: true, cartId: "cart-m" });
  expect(claimGuestCartForMember).not.toHaveBeenCalled();
  expect(recorded).toHaveLength(0);
});

it("② 無會員車＋有 guestToken → claim 成功直回", async () => {
  state.memberCartResults = [{ data: null, error: null }];
  claimGuestCartForMember.mockResolvedValue({
    status: "claimed",
    cartId: "cart-claimed",
  });

  const r = await getOrCreateMemberCart(SR, "mem-1", "m@x.com", "tok-1");

  expect(r).toEqual({ ok: true, cartId: "cart-claimed" });
  expect(recorded).toHaveLength(0);
});

it("② claim 未命中（none）→ 重查會員車命中 → 回該車", async () => {
  state.memberCartResults = [
    { data: null, error: null }, // 步驟①
    { data: { id: "cart-after" }, error: null }, // claim 後重查
  ];
  claimGuestCartForMember.mockResolvedValue({ status: "none" });

  const r = await getOrCreateMemberCart(SR, "mem-1", "m@x.com", "tok-1");

  expect(r).toEqual({ ok: true, cartId: "cart-after" });
});

it("③ 孤兒 auth user（無 guestToken）→ 先 findOrCreateMember 再 INSERT 成功", async () => {
  state.memberCartResults = [{ data: null, error: null }];
  state.insertResult = { data: { id: "cart-new" }, error: null };

  const r = await getOrCreateMemberCart(SR, "mem-1", "m@x.com");

  expect(findOrCreateMember).toHaveBeenCalledWith("mem-1", "m@x.com");
  expect(r).toEqual({ ok: true, cartId: "cart-new" });
  expect(recorded.find((x) => x.op === "insert")?.values).toEqual({
    member_id: "mem-1",
  });
});

it("③ findOrCreateMember throw（fail-closed）→ ok:false、不 INSERT", async () => {
  state.memberCartResults = [{ data: null, error: null }];
  findOrCreateMember.mockRejectedValue(new Error("member insert failed"));

  const r = await getOrCreateMemberCart(SR, "mem-1", "m@x.com");

  expect(r).toEqual({ ok: false, error: "系統忙碌，請稍後再試" });
  expect(recorded.find((x) => x.op === "insert")).toBeUndefined();
});

it("③ INSERT 撞 23505 → 重查會員車沿用", async () => {
  state.memberCartResults = [
    { data: null, error: null }, // 步驟①
    { data: { id: "cart-raced" }, error: null }, // 23505 後重查
  ];
  state.insertResult = { data: null, error: { code: "23505" } };

  const r = await getOrCreateMemberCart(SR, "mem-1", "m@x.com");

  expect(r).toEqual({ ok: true, cartId: "cart-raced" });
});

it("③ INSERT 撞 23503（FK，member row 仍缺）→ ok:false 兜底分類", async () => {
  state.memberCartResults = [{ data: null, error: null }];
  state.insertResult = { data: null, error: { code: "23503" } };

  const r = await getOrCreateMemberCart(SR, "mem-1", "m@x.com");

  expect(r).toEqual({ ok: false, error: "系統忙碌，請稍後再試" });
});
