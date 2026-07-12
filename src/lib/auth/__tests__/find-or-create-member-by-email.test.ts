/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const state = {
  // member select 依呼叫次數回傳：首查／email_exists 撞號後的重查
  memberLookups: [] as { data: { id: string } | null; error: any }[],
  createUserResult: { data: { user: { id: "user-new" } }, error: null } as {
    data: { user: { id: string } | null };
    error: any;
  },
  memberById: null as { id: string } | null,
  inserted: [] as any[],
};

function makeServiceRole() {
  return {
    auth: {
      admin: {
        createUser: vi
          .fn()
          .mockImplementation(() => Promise.resolve(state.createUserResult)),
      },
    },
    from: (table: string) => {
      let eqCol = "";
      const chain: any = {
        select: () => chain,
        eq: (col: string) => {
          eqCol = col;
          return chain;
        },
        maybeSingle: () => {
          if (table === "member" && eqCol === "email") {
            return Promise.resolve(
              state.memberLookups.shift() ?? { data: null, error: null },
            );
          }
          if (table === "member" && eqCol === "id") {
            return Promise.resolve({ data: state.memberById, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        insert: (values: any) => {
          state.inserted.push({ table, values });
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  };
}
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => makeServiceRole(),
}));

import { findOrCreateMemberByEmail } from "../find-or-create-member";

beforeEach(() => {
  state.memberLookups = [];
  state.createUserResult = { data: { user: { id: "user-new" } }, error: null };
  state.memberById = null;
  state.inserted = [];
});

describe("findOrCreateMemberByEmail", () => {
  it("email 命中既有會員 → 直接回其 id，不建 auth user", async () => {
    state.memberLookups = [{ data: { id: "member-existing" }, error: null }];

    const result = await findOrCreateMemberByEmail("buyer@example.com");

    expect(result).toEqual({ ok: true, memberId: "member-existing" });
    expect(state.inserted).toHaveLength(0);
  });

  it("查詢失敗 → 回錯誤，不誤判成查無會員去建帳號（§6）", async () => {
    state.memberLookups = [{ data: null, error: { message: "timeout" } }];

    const result = await findOrCreateMemberByEmail("buyer@example.com");

    expect(result).toMatchObject({ ok: false });
    expect(state.inserted).toHaveLength(0);
  });

  it("查無會員 → createUser＋建 member row → 回新 id", async () => {
    state.memberLookups = [{ data: null, error: null }];

    const result = await findOrCreateMemberByEmail("buyer@example.com");

    expect(result).toEqual({ ok: true, memberId: "user-new" });
    expect(state.inserted).toContainEqual({
      table: "member",
      values: { id: "user-new", email: "buyer@example.com" },
    });
  });

  it("createUser 撞 email_exists（併發輸家）→ 重查 member，勝者已建好就沿用其 id", async () => {
    state.memberLookups = [
      { data: null, error: null }, // 首查：還沒有
      { data: { id: "member-winner" }, error: null }, // 撞號後重查：勝者已建好
    ];
    state.createUserResult = {
      data: { user: null },
      error: { code: "email_exists", message: "email exists" },
    };

    const result = await findOrCreateMemberByEmail("buyer@example.com");

    expect(result).toEqual({ ok: true, memberId: "member-winner" });
  });

  it("createUser 撞 email_exists 但重查仍無 member row（孤兒 auth user）→ 回明確錯誤", async () => {
    state.memberLookups = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    state.createUserResult = {
      data: { user: null },
      error: { message: "User already registered" },
    };

    const result = await findOrCreateMemberByEmail("buyer@example.com");

    expect(result).toMatchObject({
      ok: false,
      error: "此 email 已有帳號但查無會員資料，請稍後再試",
    });
  });

  it("createUser 其他錯誤 → 回通用建立會員失敗", async () => {
    state.memberLookups = [{ data: null, error: null }];
    state.createUserResult = {
      data: { user: null },
      error: { message: "internal error" },
    };

    const result = await findOrCreateMemberByEmail("buyer@example.com");

    expect(result).toMatchObject({
      ok: false,
      error: "建立會員失敗，請稍後再試",
    });
  });
});
