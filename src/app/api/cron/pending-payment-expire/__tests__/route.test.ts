/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    CRON_SECRET: "test-cron-secret",
  },
}));

// transitionOrder 的行為（CAS 守衛、canTransition、log 寫入）已在
// state-machine.test.ts 完整覆蓋；這裡當依賴邊界整個 mock 掉，專注在這支
// route 自己的批次處理與計數邏輯。
const { transitionOrder, OrderTransitionRaceError } = vi.hoisted(() => {
  class OrderTransitionRaceError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "OrderTransitionRaceError";
    }
  }
  return { transitionOrder: vi.fn(), OrderTransitionRaceError };
});
vi.mock("@/lib/order/state-machine", () => ({
  transitionOrder: (...args: unknown[]) => transitionOrder(...args),
  OrderTransitionRaceError,
}));

type OrderRow = { id: string };

let candidates: OrderRow[] = [];
let lastFilters: Record<string, unknown> = {};
// 取消成功後順帶把該訂單的 pending payment 標 failed 的呼叫記錄
const paymentSweeps: { order_id: unknown }[] = [];
// T127①：取消前的 paid payment 批次查詢（select 分支）的可控回傳。
let paidPayments: { order_id: string }[] = [];
let paidQueryError: string | null = null;
// 鎖住防呆查詢的實際形狀：漏掉 .eq("status","paid") 或 .in() 傳錯 id 集合
// 是金流級回歸（把 pending 誤當 paid＝逾期單永不取消；範圍錯＝誤殺），
// 光靠計數斷言測不出來，必須斷言引數。
let paidGuardCapture:
  | { inCol: string; inIds: unknown; status: unknown }
  | undefined;
// post-cancel paid 再查（TOCTOU 補洞）：命中此集合的 order_id 回一筆 paid。
let paidAfterCancelIds = new Set<string>();
// post-cancel 再查的呼叫記錄（含過濾條件），斷言它查的是 paid。
let postCancelChecks: { order_id: unknown; status: unknown }[] = [];

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table === "payment") {
        const filters: Record<string, unknown> = {};
        // payment 表有三種形狀的呼叫：T127① 的批次 select（取消前防呆查詢，
        // 以 then 收尾）、post-cancel paid 再查（以 maybeSingle 收尾）、
        // 取消後的 update（pending payment 掃成 failed，以 then 收尾）。
        let isSelect = false;
        let inArgs: { col: string; ids: unknown } | undefined;
        const chain: any = {
          select: () => {
            isSelect = true;
            return chain;
          },
          update: () => chain,
          in: (col: string, ids: unknown) => {
            inArgs = { col, ids };
            return chain;
          },
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return chain;
          },
          maybeSingle: () => {
            postCancelChecks.push({
              order_id: filters.order_id,
              status: filters.status,
            });
            return Promise.resolve({
              data: paidAfterCancelIds.has(filters.order_id as string)
                ? { id: "pp1" }
                : null,
              error: null,
            });
          },
          then: (resolve: (v: unknown) => void) => {
            if (isSelect) {
              paidGuardCapture = {
                inCol: inArgs?.col ?? "",
                inIds: inArgs?.ids,
                status: filters.status,
              };
              resolve(
                paidQueryError
                  ? { data: null, error: { message: paidQueryError } }
                  : { data: paidPayments, error: null },
              );
              return;
            }
            paymentSweeps.push({ order_id: filters.order_id });
            resolve({ error: null });
          },
        };
        return chain;
      }
      if (table !== "orders") throw new Error(`unexpected table: ${table}`);
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          lastFilters[col] = val;
          return chain;
        },
        lt: (col: string, val: unknown) => {
          lastFilters[`${col}__lt`] = val;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        then: (resolve: (v: unknown) => void) => {
          resolve({ data: candidates, error: null });
        },
      };
      return chain;
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
  return new Request("http://localhost/api/cron/pending-payment-expire", {
    headers,
  });
}

beforeEach(() => {
  candidates = [];
  lastFilters = {};
  paymentSweeps.length = 0;
  paidPayments = [];
  paidQueryError = null;
  paidGuardCapture = undefined;
  paidAfterCancelIds = new Set();
  postCancelChecks = [];
  transitionOrder.mockReset();
});

describe("認證", () => {
  it("缺 Authorization header → 401", async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
    expect(transitionOrder).not.toHaveBeenCalled();
  });

  it("Authorization 錯誤 → 401", async () => {
    const res = await GET(buildRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("Authorization 正確但無候選 → 200，摘要全 0", async () => {
    const res = await GET(buildRequest("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      checked: 0,
      cancelled: 0,
      skipped: 0,
      failed: 0,
      paidConflict: 0,
      paidAfterCancel: 0,
    });
  });
});

describe("候選查詢條件", () => {
  it("只查 pending_payment 且 created_at 早於 72 小時前", async () => {
    await GET(buildRequest("Bearer test-cron-secret"));
    expect(lastFilters.status).toBe("pending_payment");
    expect(lastFilters["created_at__lt"]).toBeDefined();
  });
});

describe("逐筆處理", () => {
  it("成功轉 cancelled → cancelled 計數，帶正確 note", async () => {
    candidates = [{ id: "o1" }];
    transitionOrder.mockResolvedValue(undefined);

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body).toEqual({
      checked: 1,
      cancelled: 1,
      skipped: 0,
      failed: 0,
      paidConflict: 0,
      paidAfterCancel: 0,
    });
    expect(transitionOrder).toHaveBeenCalledWith(
      "o1",
      "cancelled",
      expect.objectContaining({ note: expect.any(String) }),
    );
    // 取消後順帶把該訂單的 pending payment 標 failed，
    // 避免死掉的 pending row 永久佔據 ecpay-reconcile 的每日候選批次
    expect(paymentSweeps).toEqual([{ order_id: "o1" }]);
  });

  it("轉換被搶先（skipped）→ 不掃 payment", async () => {
    candidates = [{ id: "o1" }];
    transitionOrder.mockRejectedValue(
      new OrderTransitionRaceError("訂單狀態已被其他流程異動：o1"),
    );

    await GET(buildRequest("Bearer test-cron-secret"));

    expect(paymentSweeps).toEqual([]);
  });

  it("併發：webhook 搶先轉 paid（OrderTransitionRaceError）→ skipped 計數，非錯誤", async () => {
    candidates = [{ id: "o1" }];
    transitionOrder.mockRejectedValue(
      new OrderTransitionRaceError("訂單狀態已被其他流程異動：o1"),
    );

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body).toEqual({
      checked: 1,
      cancelled: 0,
      skipped: 1,
      failed: 0,
      paidConflict: 0,
      paidAfterCancel: 0,
    });
  });

  it("T127①：候選已有 paid payment → skip 取消、paidConflict 計數、不掃 payment", async () => {
    candidates = [{ id: "o1" }, { id: "o2" }];
    paidPayments = [{ order_id: "o1" }];
    transitionOrder.mockResolvedValue(undefined);

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    // o1 錢已收（webhook 側卡單）：不可取消，交給 reconcile 漂移臂自癒；
    // o2 正常取消。
    expect(body).toEqual({
      checked: 2,
      cancelled: 1,
      skipped: 0,
      failed: 0,
      paidConflict: 1,
      paidAfterCancel: 0,
    });
    expect(transitionOrder).toHaveBeenCalledTimes(1);
    expect(transitionOrder).toHaveBeenCalledWith(
      "o2",
      "cancelled",
      expect.objectContaining({ note: expect.any(String) }),
    );
    expect(paymentSweeps).toEqual([{ order_id: "o2" }]);
    // 防呆查詢形狀：必須以候選 id 集合為範圍、只認 status='paid'——這兩個
    // 過濾條件任一回歸都是金流級錯誤（pending 誤當 paid／範圍錯誤殺）。
    expect(paidGuardCapture).toEqual({
      inCol: "order_id",
      inIds: ["o1", "o2"],
      status: "paid",
    });
  });

  it("T127①：post-cancel paid 再查——取消後才發現 payment 已 paid（TOCTOU 窄窗）→ paidAfterCancel 計數", async () => {
    candidates = [{ id: "o1" }];
    // 批次快照時還沒 paid（paidPayments 空），cancel 之後的再查才命中：
    // 模擬「快照後、cancel 前 webhook 翻 paid 且重送耗盡」的窄窗競態。
    paidAfterCancelIds = new Set(["o1"]);
    transitionOrder.mockResolvedValue(undefined);

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body).toEqual({
      checked: 1,
      cancelled: 1,
      skipped: 0,
      failed: 0,
      paidConflict: 0,
      paidAfterCancel: 1,
    });
    // 再查必須查 paid（不是 pending）——它的職責是偵測「錢收在剛取消的
    // 訂單上」，之後走 §6.1 人工裁決。
    expect(postCancelChecks).toEqual([{ order_id: "o1", status: "paid" }]);
  });

  it("T127①：paid payment 批次查詢失敗 → fail-safe 整批不取消、throw→500（不誤報綠燈）", async () => {
    candidates = [{ id: "o1" }, { id: "o2" }];
    paidQueryError = "connection timeout";

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    // 無法確認「有沒有已收款」就整批跳過：寧可晚一天取消，不可誤取消已付款
    // 訂單。作法沿用候選查詢的 throw→外層 catch→HTTP 500（R2）：回 200 會讓
    // cron 監控把「整批被跳過」誤看成綠燈，也不再用 failed 計數承載「整批未
    // 檢查」（污染 failed 的單筆語意）。
    expect(res.status).toBe(500);
    expect(body).toEqual({
      checked: 0,
      cancelled: 0,
      skipped: 0,
      failed: 0,
      paidConflict: 0,
      paidAfterCancel: 0,
    });
    expect(transitionOrder).not.toHaveBeenCalled();
    expect(paymentSweeps).toEqual([]);
  });

  it("非預期錯誤 → failed 計數，繼續處理下一筆", async () => {
    candidates = [{ id: "o1" }, { id: "o2" }];
    transitionOrder
      .mockRejectedValueOnce(new Error("DB 連線失敗"))
      .mockResolvedValueOnce(undefined);

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body).toEqual({
      checked: 2,
      cancelled: 1,
      skipped: 0,
      failed: 1,
      paidConflict: 0,
      paidAfterCancel: 0,
    });
    expect(transitionOrder).toHaveBeenCalledTimes(2);
  });
});
