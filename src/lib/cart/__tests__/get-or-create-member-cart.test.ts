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
const mergeCarts = vi.fn();
const reportMergeFailure = vi.fn();
const selectMemberCartId = vi.fn();
vi.mock("@/lib/cart/merge-guest-cart", () => ({
  claimGuestCartForMember: (...a: unknown[]) => claimGuestCartForMember(...a),
  mergeCarts: (...a: unknown[]) => mergeCarts(...a),
  reportMergeFailure: (...a: unknown[]) => reportMergeFailure(...a),
  selectMemberCartId: (...a: unknown[]) => selectMemberCartId(...a),
}));

type Res = { data: any; error: any };
const state = {
  memberCartResults: [] as Res[], // selectMemberCartId 依序消耗
  guestCartResult: { data: null, error: null } as Res, // conflict 路徑查 guest 車
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
        // selectMemberCartId 已隨 #7 去重改由 merge-guest-cart 模組 mock 供給，
        // chain 的 maybeSingle 只剩 conflict 路徑的 guest 車 SELECT 在用。
        maybeSingle: async () => state.guestCartResult,
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
  mergeCarts.mockReset();
  mergeCarts.mockResolvedValue(undefined);
  reportMergeFailure.mockReset();
  reportMergeFailure.mockResolvedValue(undefined);
  selectMemberCartId.mockReset();
  selectMemberCartId.mockImplementation(async () => {
    const r = state.memberCartResults.shift() ?? { data: null, error: null };
    if (r.error) return { ok: false, error: r.error };
    return { ok: true, cartId: r.data?.id ?? null };
  });
  state.memberCartResults = [];
  state.guestCartResult = { data: null, error: null };
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

// max review #1：claim 的 error／conflict 不得與 none 混流——error 若照舊落到
// ③建空車，原 guest 車（可能有品項）會從此無人可達且零 Sentry 訊號。
it("② claim 回 error（真 DB 失敗）→ 回報 Sentry＋ok:false，不建空車", async () => {
  state.memberCartResults = [{ data: null, error: null }];
  claimGuestCartForMember.mockResolvedValue({
    status: "error",
    error: { message: "boom" },
  });

  const r = await getOrCreateMemberCart(SR, "mem-1", "m@x.com", "tok-1");

  expect(r).toEqual({ ok: false, error: "系統忙碌，請稍後再試" });
  expect(reportMergeFailure).toHaveBeenCalledWith({ message: "boom" });
  expect(recorded.find((x) => x.op === "insert")).toBeUndefined();
});

it("② claim 回 conflict → 重查命中 → mergeCarts 併入搶輸的 guest 車、回贏家車", async () => {
  state.memberCartResults = [
    { data: null, error: null }, // 步驟①
    { data: { id: "cart-won" }, error: null }, // conflict 後重查
  ];
  claimGuestCartForMember.mockResolvedValue({ status: "conflict" });
  state.guestCartResult = {
    data: { id: "G", member_id: null, updated_at: "t" },
    error: null,
  };

  const r = await getOrCreateMemberCart(SR, "mem-1", "m@x.com", "tok-1");

  expect(r).toEqual({ ok: true, cartId: "cart-won" });
  expect(mergeCarts).toHaveBeenCalledWith(SR, "cart-won", {
    id: "G",
    member_id: null,
    updated_at: "t",
  });
});

it("② claim 回 conflict → 重查命中但 guest 車已被他人 claim → 不 mergeCarts、仍回贏家車", async () => {
  state.memberCartResults = [
    { data: null, error: null },
    { data: { id: "cart-won" }, error: null },
  ];
  claimGuestCartForMember.mockResolvedValue({ status: "conflict" });
  state.guestCartResult = {
    data: { id: "G", member_id: "other", updated_at: "t" },
    error: null,
  };

  const r = await getOrCreateMemberCart(SR, "mem-1", "m@x.com", "tok-1");

  expect(r).toEqual({ ok: true, cartId: "cart-won" });
  expect(mergeCarts).not.toHaveBeenCalled();
});

it("② claim 回 conflict 卻查無會員車（不一致）→ 回報＋ok:false", async () => {
  state.memberCartResults = [
    { data: null, error: null },
    { data: null, error: null }, // conflict 後重查仍無
  ];
  claimGuestCartForMember.mockResolvedValue({ status: "conflict" });

  const r = await getOrCreateMemberCart(SR, "mem-1", "m@x.com", "tok-1");

  expect(r).toEqual({ ok: false, error: "系統忙碌，請稍後再試" });
  expect(reportMergeFailure).toHaveBeenCalledTimes(1);
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
