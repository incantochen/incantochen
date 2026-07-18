/* eslint-disable @typescript-eslint/no-explicit-any */
// T81：身分解析——登入→member、訪客→guest、皆無→none。核心不變式：登入態
// 一律回 member，絕不 fallback 到 guest token（即使瀏覽器仍帶 guest cookie）。
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const state = {
  user: null as { id: string } | null,
  cookie: undefined as string | undefined,
  authError: null as unknown,
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "guest_token" && state.cookie !== undefined
        ? { value: state.cookie }
        : undefined,
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.user },
        error: state.authError,
      }),
    },
  }),
}));

const findCalls: { table: string; col: string; val: string }[] = [];
function makeServiceRole() {
  return {
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: string) => {
          findCalls.push({ table, col, val });
          return chain;
        },
        maybeSingle: async () => ({
          data: { id: "cart-x", updated_at: "t" },
          error: null,
        }),
      };
      return chain;
    },
  };
}

import { AuthSessionMissingError } from "@supabase/supabase-js";
import {
  resolveCartIdentity,
  findCartByIdentity,
} from "../resolve-cart-identity";

beforeEach(() => {
  state.user = null;
  state.cookie = undefined;
  state.authError = null;
  findCalls.length = 0;
});

describe("resolveCartIdentity（T81）", () => {
  it("已登入 → member（memberId＝user.id）", async () => {
    state.user = { id: "mem-1" };
    expect(await resolveCartIdentity()).toEqual({
      kind: "member",
      memberId: "mem-1",
    });
  });

  it("未登入但有 guest cookie → guest", async () => {
    state.cookie = "tok-1";
    expect(await resolveCartIdentity()).toEqual({
      kind: "guest",
      guestToken: "tok-1",
    });
  });

  it("未登入且無 cookie → none", async () => {
    expect(await resolveCartIdentity()).toEqual({ kind: "none" });
  });

  // Identity invariant：登入態即使還帶著 guest cookie，也必須回 member（不 fallback
  // token）——這是併車「他人車→刪 cookie」隱私防線的前提。
  it("已登入且同時持 guest cookie → 仍回 member（絕不 fallback token）", async () => {
    state.user = { id: "mem-1" };
    state.cookie = "leftover-tok";
    expect(await resolveCartIdentity()).toEqual({
      kind: "member",
      memberId: "mem-1",
    });
  });

  // §6：查詢失敗 ≠ 查無資料。AuthSessionMissingError＝單純沒登入（訪客常態，
  // getUser 無 session 時的正常回傳），照常走 guest／none；其餘 error＝Auth 端
  // 暫時性故障，不可誤判成訪客——上拋交呼叫端處理。
  it("getUser 回 AuthSessionMissingError（訪客常態）→ 照常 guest／none", async () => {
    state.authError = new AuthSessionMissingError();
    state.cookie = "tok-1";
    expect(await resolveCartIdentity()).toEqual({
      kind: "guest",
      guestToken: "tok-1",
    });

    state.cookie = undefined;
    expect(await resolveCartIdentity()).toEqual({ kind: "none" });
  });

  it("getUser 回非 session-missing 的 error（Auth 暫時性故障）→ throw、不掉進 guest 分支", async () => {
    state.authError = { message: "fetch failed", name: "AuthRetryableFetchError" };
    state.cookie = "tok-1"; // 即使帶著 cookie 也不得誤判成 guest
    await expect(resolveCartIdentity()).rejects.toThrow("身分解析失敗");
  });
});

describe("findCartByIdentity（T81）", () => {
  it("member → 以 member_id 查", async () => {
    const sr = makeServiceRole() as any;
    const { data } = await findCartByIdentity(sr, {
      kind: "member",
      memberId: "mem-1",
    });
    expect(data).toEqual({ id: "cart-x", updated_at: "t" });
    expect(findCalls).toEqual([
      { table: "cart", col: "member_id", val: "mem-1" },
    ]);
  });

  it("guest → 以 guest_token 查", async () => {
    const sr = makeServiceRole() as any;
    const { data } = await findCartByIdentity(sr, {
      kind: "guest",
      guestToken: "tok-1",
    });
    expect(data).toEqual({ id: "cart-x", updated_at: "t" });
    expect(findCalls).toEqual([
      { table: "cart", col: "guest_token", val: "tok-1" },
    ]);
  });

  it("none → 不查 DB，回 {data:null,error:null}", async () => {
    const sr = makeServiceRole() as any;
    const { data, error } = await findCartByIdentity(sr, { kind: "none" });
    expect(data).toBeNull();
    expect(error).toBeNull();
    expect(findCalls).toHaveLength(0);
  });
});
