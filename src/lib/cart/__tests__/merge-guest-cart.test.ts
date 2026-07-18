/* eslint-disable @typescript-eslint/no-explicit-any */
// T81：登入併車（mergeGuestCartOnLogin）情境矩陣。全程 fail-soft（記 Sentry 不
// throw），ownership transition 不留 orphan window，claim 清 token／merge 條件式
// 刪殼＋updated_at guard，且函式冪等（會被 OTP／magic link 兩路徑重複呼叫）。
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const captureException = vi.fn();
const flush = vi.fn(async () => true);
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
  flush: () => flush(),
}));

const touchCalls: string[] = [];
vi.mock("@/lib/cart/touch-cart-updated-at", () => ({
  touchCartUpdatedAt: async (_sr: unknown, cartId: string) => {
    void _sr;
    touchCalls.push(cartId);
  },
}));

let cookieValue: string | undefined;
let cookieDeleted = false;
let cookiesThrow = false;
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (cookiesThrow) throw new Error("cookies boom");
    return {
      get: (name: string) =>
        name === "guest_token" && cookieValue !== undefined
          ? { value: cookieValue }
          : undefined,
      delete: () => {
        cookieDeleted = true;
      },
    };
  },
}));

type Res = { data: any; error: any };
const state = {
  guestCartResult: { data: null, error: null } as Res,
  memberCartResults: [] as Res[], // 依序消耗（claim conflict 會再查一次）
  claimResults: [] as Res[], // 依序消耗（retry 會再 claim 一次）
  moveItemsResult: { data: null, error: null } as Res,
  deleteShellResult: { data: [{ id: "G" }], error: null } as Res,
  backfillResult: { data: null, error: null } as Res,
  lockResult: { data: [{ id: "G" }], error: null } as Res, // mergeCarts a0 CAS 鎖
};

const ops: {
  table: string;
  op: string;
  eq: Record<string, any>;
  values?: any;
}[] = [];

function makeServiceRole() {
  return {
    from(table: string) {
      const q: any = { table, op: "select", eq: {}, is: {} };
      const resolve = (): Res => {
        ops.push({ table: q.table, op: q.op, eq: { ...q.eq }, values: q.values });
        if (table === "cart_item" && q.op === "update")
          return state.moveItemsResult;
        if (table === "cart") {
          if (q.op === "select") {
            if ("guest_token" in q.eq) return state.guestCartResult;
            if ("member_id" in q.eq)
              return (
                state.memberCartResults.shift() ?? { data: null, error: null }
              );
          }
          if (q.op === "update") {
            if ("guest_token" in q.eq)
              return state.claimResults.shift() ?? { data: null, error: null };
            // mergeCarts a0 CAS 鎖：eq 帶 id＋updated_at；backfill 只帶 id
            if ("id" in q.eq && "updated_at" in q.eq) return state.lockResult;
            if ("id" in q.eq) return state.backfillResult;
          }
          if (q.op === "delete") return state.deleteShellResult;
        }
        return { data: null, error: null };
      };
      const chain: any = {
        select: () => chain, // op 保持不變（update/delete 後接 .select("id") 不該變回 select）
        update: (v: any) => {
          q.op = "update";
          q.values = v;
          return chain;
        },
        delete: () => {
          q.op = "delete";
          return chain;
        },
        eq: (col: string, val: any) => {
          q.eq[col] = val;
          return chain;
        },
        is: (col: string, val: any) => {
          q.is[col] = val;
          return chain;
        },
        maybeSingle: async () => resolve(),
        then: (res: (v: Res) => void) => res(resolve()),
      };
      return chain;
    },
  };
}
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => makeServiceRole(),
}));

import {
  mergeGuestCartOnLogin,
  backfillCartMemberId,
} from "../merge-guest-cart";

const MEMBER = "mem-1";

beforeEach(() => {
  captureException.mockClear();
  flush.mockClear();
  touchCalls.length = 0;
  ops.length = 0;
  cookieValue = "tok-1";
  cookieDeleted = false;
  cookiesThrow = false;
  state.guestCartResult = { data: null, error: null };
  state.memberCartResults = [];
  state.claimResults = [];
  state.moveItemsResult = { data: null, error: null };
  state.deleteShellResult = { data: [{ id: "G" }], error: null };
  state.backfillResult = { data: null, error: null };
  state.lockResult = { data: [{ id: "G" }], error: null };
});

const cartOps = () => ops.filter((o) => o.table === "cart");
const didClaim = () =>
  cartOps().some((o) => o.op === "update" && "guest_token" in o.eq);
const didMoveItems = () =>
  ops.some((o) => o.table === "cart_item" && o.op === "update");
const didDeleteShell = () =>
  ops.some((o) => o.table === "cart" && o.op === "delete");

describe("mergeGuestCartOnLogin（T81）", () => {
  it("① 無 cookie → no-op（不碰 DB、不刪 cookie）", async () => {
    cookieValue = undefined;
    await mergeGuestCartOnLogin(MEMBER);
    expect(ops).toHaveLength(0);
    expect(cookieDeleted).toBe(false);
  });

  it("② 查無 guest 車 → no-op（cookie 留給 addToCart 重簽）", async () => {
    state.guestCartResult = { data: null, error: null };
    await mergeGuestCartOnLogin(MEMBER);
    expect(didClaim()).toBe(false);
    expect(cookieDeleted).toBe(false);
  });

  it("③ guest 車屬他人 → 不動車、刪本地 cookie、不 claim", async () => {
    state.guestCartResult = {
      data: { id: "G", member_id: "other", updated_at: "t" },
      error: null,
    };
    await mergeGuestCartOnLogin(MEMBER);
    expect(didClaim()).toBe(false);
    expect(didMoveItems()).toBe(false);
    expect(cookieDeleted).toBe(true);
  });

  it("④ 冪等：guest 車已是自己的 → 防禦性 no-op＋刪 cookie（不 claim/merge）", async () => {
    state.guestCartResult = {
      data: { id: "G", member_id: MEMBER, updated_at: "t" },
      error: null,
    };
    await mergeGuestCartOnLogin(MEMBER);
    expect(didClaim()).toBe(false);
    expect(didMoveItems()).toBe(false);
    // 未查會員車（防禦性 no-op 在步驟 2 就 return）
    expect(
      cartOps().some((o) => o.op === "select" && "member_id" in o.eq),
    ).toBe(false);
    expect(cookieDeleted).toBe(true);
  });

  it("⑤ 無會員車 → claim 成功（清 token）＋刪 cookie", async () => {
    state.guestCartResult = {
      data: { id: "G", member_id: null, updated_at: "t" },
      error: null,
    };
    state.memberCartResults = [{ data: null, error: null }];
    state.claimResults = [{ data: [{ id: "G" }], error: null }];

    await mergeGuestCartOnLogin(MEMBER);

    expect(didClaim()).toBe(true);
    expect(didMoveItems()).toBe(false); // claim 而非 merge
    expect(cookieDeleted).toBe(true);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("⑥ claim 回 0 列 → 重走一次仍 0 列 → fail-soft（不刪 cookie、不 throw）", async () => {
    state.guestCartResult = {
      data: { id: "G", member_id: null, updated_at: "t" },
      error: null,
    };
    state.memberCartResults = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    state.claimResults = [
      { data: [], error: null },
      { data: [], error: null },
    ];

    await mergeGuestCartOnLogin(MEMBER);

    // claim 嘗試兩次（retry 一次）
    const claims = cartOps().filter(
      (o) => o.op === "update" && "guest_token" in o.eq,
    );
    expect(claims).toHaveLength(2);
    expect(cookieDeleted).toBe(false);
  });

  it("⑦ claim 撞 23505 → 重查會員車命中 → 轉 merge", async () => {
    state.guestCartResult = {
      data: { id: "G", member_id: null, updated_at: "t" },
      error: null,
    };
    state.memberCartResults = [
      { data: null, error: null }, // 步驟 3：無會員車 → 走 claim
      { data: { id: "M" }, error: null }, // 23505 後重查：命中
    ];
    state.claimResults = [{ data: null, error: { code: "23505" } }];

    await mergeGuestCartOnLogin(MEMBER);

    expect(didMoveItems()).toBe(true);
    expect(didDeleteShell()).toBe(true);
    expect(cookieDeleted).toBe(true);
  });

  it("⑧ 有會員車 → merge：搬列＋條件刪殼＋touch＋刪 cookie", async () => {
    state.guestCartResult = {
      data: { id: "G", member_id: null, updated_at: "t" },
      error: null,
    };
    state.memberCartResults = [{ data: { id: "M" }, error: null }];
    state.deleteShellResult = { data: [{ id: "G" }], error: null };

    await mergeGuestCartOnLogin(MEMBER);

    expect(didMoveItems()).toBe(true);
    // a0 CAS 鎖以「步驟 2 讀到的 updated_at」為前提佔位
    const lock = ops.find(
      (o) =>
        o.table === "cart" &&
        o.op === "update" &&
        "id" in o.eq &&
        "updated_at" in o.eq,
    );
    expect(lock?.eq.updated_at).toBe("t");
    // 刪殼帶 updated_at guard——比對的是 a0 鎖寫入的新值（非步驟 2 的舊值）
    const del = ops.find((o) => o.table === "cart" && o.op === "delete");
    expect(del?.eq.updated_at).toBe(lock?.values?.updated_at);
    expect(touchCalls).toContain("M");
    expect(cookieDeleted).toBe(true);
  });

  it("⑧-b merge 鎖不到（a0 CAS 回 0 列：他方併發 merge／claim 搶先）→ 不搬列、不刪殼、不刪 cookie", async () => {
    state.guestCartResult = {
      data: { id: "G", member_id: null, updated_at: "t" },
      error: null,
    };
    state.memberCartResults = [{ data: { id: "M" }, error: null }];
    state.lockResult = { data: [], error: null }; // 鎖 0 列

    await mergeGuestCartOnLogin(MEMBER);

    expect(didMoveItems()).toBe(false);
    expect(didDeleteShell()).toBe(false);
    expect(cookieDeleted).toBe(false);
    expect(captureException).not.toHaveBeenCalled(); // 正常競態，非錯誤
  });

  it("⑧-c merge 鎖 DB error → fail-soft 記 Sentry、不搬列", async () => {
    state.guestCartResult = {
      data: { id: "G", member_id: null, updated_at: "t" },
      error: null,
    };
    state.memberCartResults = [{ data: { id: "M" }, error: null }];
    state.lockResult = { data: null, error: { message: "boom" } };

    await mergeGuestCartOnLogin(MEMBER);

    expect(didMoveItems()).toBe(false);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("⑨ 刪殼回 0 列（updated_at guard：殼被併發加車復活）→ 不刪 cookie（但仍 touch）", async () => {
    state.guestCartResult = {
      data: { id: "G", member_id: null, updated_at: "t" },
      error: null,
    };
    state.memberCartResults = [{ data: { id: "M" }, error: null }];
    state.deleteShellResult = { data: [], error: null };

    await mergeGuestCartOnLogin(MEMBER);

    expect(didMoveItems()).toBe(true);
    expect(touchCalls).toContain("M");
    expect(cookieDeleted).toBe(false);
  });

  it("⑩ 刪殼 DB error → 不 throw、記 Sentry、不刪 cookie", async () => {
    state.guestCartResult = {
      data: { id: "G", member_id: null, updated_at: "t" },
      error: null,
    };
    state.memberCartResults = [{ data: { id: "M" }, error: null }];
    state.deleteShellResult = { data: null, error: { message: "boom" } };

    await mergeGuestCartOnLogin(MEMBER);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(cookieDeleted).toBe(false);
  });

  it("⑪ 查 guest 車 {error} → fail-soft（記 Sentry、不 throw、不刪 cookie）", async () => {
    state.guestCartResult = { data: null, error: { message: "boom" } };

    await mergeGuestCartOnLogin(MEMBER);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(didClaim()).toBe(false);
    expect(cookieDeleted).toBe(false);
  });

  // 結構性 fail-soft 回歸鎖：try 包住整個函式體（含 cookies()），任何一步 throw
  // 都不得冒泡——登入呼叫端已移除各自的 try/catch 包裝，全靠這個保證。
  it("⑫ cookies() 本身 throw → 仍不冒泡、記 Sentry（fail-soft 是結構保證）", async () => {
    cookiesThrow = true;

    await expect(mergeGuestCartOnLogin(MEMBER)).resolves.toBeUndefined();

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(ops).toHaveLength(0);
  });
});

describe("backfillCartMemberId（T81，結帳即會員：保留 guest_token）", () => {
  it("成功（保留 token，只設 member_id）→ 不記 Sentry", async () => {
    state.backfillResult = { data: null, error: null };
    const sr = makeServiceRole() as any;
    await backfillCartMemberId(sr, MEMBER, "cart-1");
    // update 只帶 member_id／updated_at，未清 guest_token
    const upd = ops.find((o) => o.table === "cart" && o.op === "update");
    expect(upd).toBeDefined();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("失敗 → fail-soft 記 Sentry、不 throw", async () => {
    state.backfillResult = { data: null, error: { message: "boom" } };
    const sr = makeServiceRole() as any;
    await expect(
      backfillCartMemberId(sr, MEMBER, "cart-1"),
    ).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
