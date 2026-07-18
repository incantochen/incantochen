/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    CRON_SECRET: "test-cron-secret",
  },
}));

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

type CartRow = { id: string; member_id: string | null; updated_at: string };

// 候選 SELECT 回傳的列（route 只 select id，但這裡連 member_id/updated_at 一起
// 帶著，方便 DELETE 階段依「守衛條件」重新過濾，模擬空窗內被 touch/claim 的車。
let candidates: CartRow[] = [];
let selectError: { message: string } | null = null;
let deleteError: { message: string } | null = null;

// DELETE 收到的 in() id 清單與守衛過濾條件，供斷言 route 有把候選條件重跑一次。
let deleteFilters: {
  ids: string[] | null;
  memberIdNull: boolean;
  updatedBefore: string | null;
};

function resetDeleteFilters() {
  deleteFilters = { ids: null, memberIdNull: false, updatedBefore: null };
}

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table !== "cart") throw new Error(`unexpected table: ${table}`);

      // 候選 SELECT 鏈：.select().is().lt().order().limit() → resolve
      const selectChain: any = {
        select: () => selectChain,
        is: () => selectChain,
        lt: () => selectChain,
        order: () => selectChain,
        limit: () => selectChain,
        then: (resolve: (v: unknown) => void) => {
          resolve({
            data: candidates.map((c) => ({ id: c.id })),
            error: selectError,
          });
        },
      };

      // DELETE 鏈：.delete().in().is().lt().select() → resolve；守衛條件會被
      // 記錄下來，並實際套用到候選列上決定哪些「真的被刪」。
      const deleteChain: any = {
        delete: () => deleteChain,
        in: (_col: string, ids: string[]) => {
          deleteFilters.ids = ids;
          return deleteChain;
        },
        is: (col: string, val: unknown) => {
          if (col === "member_id" && val === null) {
            deleteFilters.memberIdNull = true;
          }
          return deleteChain;
        },
        lt: (col: string, val: string) => {
          if (col === "updated_at") deleteFilters.updatedBefore = val;
          return deleteChain;
        },
        select: () => deleteChain,
        then: (resolve: (v: unknown) => void) => {
          if (deleteError) {
            resolve({ data: null, error: deleteError });
            return;
          }
          const ids = new Set(deleteFilters.ids ?? []);
          const cutoff = deleteFilters.updatedBefore;
          // DB 端會依守衛條件重新求值當下的列狀態：被 touch（updated_at 推新）
          // 或被 claim（member_id 非 null）的車不再命中，故不會被刪。
          const deleted = candidates.filter((c) => {
            if (!ids.has(c.id)) return false;
            if (deleteFilters.memberIdNull && c.member_id !== null) return false;
            if (cutoff && !(c.updated_at < cutoff)) return false;
            return true;
          });
          resolve({ data: deleted.map((c) => ({ id: c.id })), error: null });
        },
      };

      // route 先呼叫 .select(...)（候選）、後呼叫 .delete()（刪除），用同一個
      // from() 回傳物件即可——把兩條鏈的入口方法都掛上。
      return {
        select: selectChain.select,
        delete: deleteChain.delete,
      };
    },
  };
}

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => makeServiceRole(),
}));

import { GET } from "../route";

function buildRequest(auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.authorization = auth;
  return new Request("http://localhost/api/cron/cart-cleanup", { headers });
}

// 早於 90 天前（一定會落入候選）與剛剛被 touch（現在）的時間戳。
const OLD = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
const FRESH = new Date().toISOString();

beforeEach(() => {
  candidates = [];
  selectError = null;
  deleteError = null;
  resetDeleteFilters();
  captureException.mockReset();
});

describe("認證", () => {
  it("缺 Authorization header → 401", async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
  });

  it("Authorization 錯誤 → 401", async () => {
    const res = await GET(buildRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("無候選 → 200，deleted: 0", async () => {
    const res = await GET(buildRequest("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 0 });
  });
});

describe("守衛式刪除（F-022）", () => {
  it("正常候選全數過期未認領 → 全數刪除", async () => {
    candidates = [
      { id: "c1", member_id: null, updated_at: OLD },
      { id: "c2", member_id: null, updated_at: OLD },
    ];

    const res = await GET(buildRequest("Bearer test-cron-secret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    // DELETE 有重跑候選條件（member_id IS NULL + updated_at < cutoff）。
    expect(deleteFilters.memberIdNull).toBe(true);
    expect(deleteFilters.updatedBefore).not.toBeNull();
    expect(deleteFilters.ids).toEqual(["c1", "c2"]);
  });

  it("候選在 DELETE 前被 touch（updated_at 推新）→ 該車存活、deleted 計數如實", async () => {
    // c1 在 SELECT 之後、DELETE 之前被 addToCart/touchCartUpdatedAt 推新
    // updated_at（車已復活）；守衛的 updated_at < cutoff 不再命中，c1 存活。
    candidates = [
      { id: "c1", member_id: null, updated_at: FRESH },
      { id: "c2", member_id: null, updated_at: OLD },
    ];

    const res = await GET(buildRequest("Bearer test-cron-secret"));

    expect(res.status).toBe(200);
    // 只有 c2 真的被刪；deleted 反映 DELETE 實際命中列數，非候選數。
    expect(await res.json()).toEqual({ deleted: 1 });
  });

  it("候選在 DELETE 前被登入認領（member_id 被設）→ 該車存活（T81 兌現後情境）", async () => {
    // c1 在空窗內被會員登入認領，member_id 不再是 null；守衛擋下，c1 存活，
    // 避免刪掉會員剛併入的購物車。
    candidates = [
      { id: "c1", member_id: "member-123", updated_at: OLD },
      { id: "c2", member_id: null, updated_at: OLD },
    ];

    const res = await GET(buildRequest("Bearer test-cron-secret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });
  });
});

describe("錯誤處理", () => {
  it("候選查詢失敗 → 500、回報 Sentry", async () => {
    selectError = { message: "connection reset" };

    const res = await GET(buildRequest("Bearer test-cron-secret"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ deleted: 0 });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("刪除失敗 → 500、回報 Sentry", async () => {
    candidates = [{ id: "c1", member_id: null, updated_at: OLD }];
    deleteError = { message: "deadlock detected" };

    const res = await GET(buildRequest("Bearer test-cron-secret"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ deleted: 0 });
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
