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

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table === "payment") {
        const filters: Record<string, unknown> = {};
        // payment 表有兩種形狀的呼叫：T127① 的 select（取消前防呆查詢）與
        // 取消後的 update（pending payment 掃成 failed），以有無呼叫 select 分流。
        let isSelect = false;
        const chain: any = {
          select: () => {
            isSelect = true;
            return chain;
          },
          update: () => chain,
          in: () => chain,
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return chain;
          },
          then: (resolve: (v: unknown) => void) => {
            if (isSelect) {
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
    });
    expect(transitionOrder).toHaveBeenCalledTimes(1);
    expect(transitionOrder).toHaveBeenCalledWith(
      "o2",
      "cancelled",
      expect.objectContaining({ note: expect.any(String) }),
    );
    expect(paymentSweeps).toEqual([{ order_id: "o2" }]);
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
    });
    expect(transitionOrder).toHaveBeenCalledTimes(2);
  });
});
