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

// 候選 SELECT 收到的守衛過濾條件，供斷言 route 有把守衛條件套在「兩道關卡」的
// 第一道（SELECT）上——DELETE 守衛只是縱深，SELECT 才是批量預算的把關者。
let selectFilters: {
  memberIdNull: boolean;
  updatedBefore: string | null;
  limit: number | null;
};

function resetSelectFilters() {
  selectFilters = { memberIdNull: false, updatedBefore: null, limit: null };
}

// DELETE 收到的 in() id 清單與守衛過濾條件，供斷言 route 有把候選條件重跑一次。
// selectCalled：DELETE 是否有 chain .select("id")——真實 supabase-js 未 chain
// 時回 data:null，count 會變 0，故需可偵測。
let deleteFilters: {
  ids: string[] | null;
  memberIdNull: boolean;
  updatedBefore: string | null;
  selectCalled: boolean;
};

function resetDeleteFilters() {
  deleteFilters = {
    ids: null,
    memberIdNull: false,
    updatedBefore: null,
    selectCalled: false,
  };
}

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table !== "cart") throw new Error(`unexpected table: ${table}`);

      // 候選 SELECT 鏈：.select().is().lt().order().limit() → resolve；守衛條件
      // 記錄下來，供斷言 route 有在 SELECT 端也套上（否則批量預算會被污染）。
      const selectChain: any = {
        select: () => selectChain,
        is: (col: string, val: unknown) => {
          if (col === "member_id" && val === null) {
            selectFilters.memberIdNull = true;
          }
          return selectChain;
        },
        lt: (col: string, val: string) => {
          if (col === "updated_at") selectFilters.updatedBefore = val;
          return selectChain;
        },
        order: () => selectChain,
        limit: (n: number) => {
          selectFilters.limit = n;
          return selectChain;
        },
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
        select: () => {
          deleteFilters.selectCalled = true;
          return deleteChain;
        },
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
          // 真實 supabase-js：DELETE 未 chain .select() → RETURNING 無資料、data
          // 為 null；未忠實反映會讓「拿掉 .select("id") 導致 deleted 恆 0」的
          // 回歸無法被測到。
          resolve({
            data: deleteFilters.selectCalled
              ? deleted.map((c) => ({ id: c.id }))
              : null,
            error: null,
          });
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
  resetSelectFilters();
  resetDeleteFilters();
  captureException.mockReset();
});

describe("認證", () => {
  it("缺 Authorization header → 401，且未碰 DB（認證先於查詢）", async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
    // 認證須短路在任何 DB 存取之前：若排序被改成先查後驗，未授權請求會打到
    // SELECT／DELETE，這裡的 null 斷言即失守（比照 pending-payment-expire 測試）。
    expect(deleteFilters.ids).toBeNull();
    expect(selectFilters.limit).toBeNull();
  });

  it("Authorization 錯誤 → 401，且未碰 DB", async () => {
    const res = await GET(buildRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(deleteFilters.ids).toBeNull();
    expect(selectFilters.limit).toBeNull();
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
    // 第一道關卡＝候選 SELECT：守衛條件（member_id IS NULL + updated_at < cutoff）
    // ＋批量上限必須套在這裡，否則批次預算會被會員車／復活車污染而餓死真正逾期車。
    expect(selectFilters.memberIdNull).toBe(true);
    expect(selectFilters.updatedBefore).not.toBeNull();
    expect(selectFilters.limit).toBe(500);
    // 第二道關卡＝DELETE 重跑候選條件（縱深，防 SELECT→DELETE 空窗的 TOCTOU）。
    expect(deleteFilters.memberIdNull).toBe(true);
    expect(deleteFilters.updatedBefore).not.toBeNull();
    expect(deleteFilters.ids).toEqual(["c1", "c2"]);
    // DELETE 必須 chain .select("id")，否則 supabase-js 回 data:null、deleted 恆 0。
    expect(deleteFilters.selectCalled).toBe(true);
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
