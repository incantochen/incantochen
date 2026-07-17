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
// T110 分歧檢查用：這批候選中「已有 paid payment」的訂單 order_id 清單。
let paidPaymentOrderIds: string[] = [];
// 模擬分歧檢查的 payment select 回傳 { error }（暫時性 DB 故障）。
let paidCheckError: string | null = null;
let lastFilters: Record<string, unknown> = {};
// 取消成功後順帶把該訂單的 pending payment 標 failed 的呼叫記錄
const paymentSweeps: { order_id: unknown }[] = [];

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table === "payment") {
        const filters: Record<string, unknown> = {};
        // payment 表被兩種查詢用到：T110 分歧檢查（select .in .eq）與取消後
        // 的 pending→failed sweep（update .eq .eq），以 op 分流。
        let op: "select" | "update" | null = null;
        const chain: any = {
          select: () => {
            op = "select";
            return chain;
          },
          update: () => {
            op = "update";
            return chain;
          },
          in: (col: string, val: unknown) => {
            filters[col] = val;
            return chain;
          },
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return chain;
          },
          then: (resolve: (v: unknown) => void) => {
            if (op === "select") {
              // 分歧檢查：撈候選中已 paid 的 order_id
              if (paidCheckError) {
                resolve({ data: null, error: { message: paidCheckError } });
                return;
              }
              const ids = (filters.order_id as string[] | undefined) ?? [];
              resolve({
                data: paidPaymentOrderIds
                  .filter((id) => ids.includes(id))
                  .map((id) => ({ order_id: id })),
                error: null,
              });
              return;
            }
            // 取消後把 pending payment 標 failed 的 sweep
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
  paidPaymentOrderIds = [];
  paidCheckError = null;
  lastFilters = {};
  paymentSweeps.length = 0;
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
      diverged: 0,
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
      diverged: 0,
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
      diverged: 0,
    });
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
      diverged: 0,
    });
    expect(transitionOrder).toHaveBeenCalledTimes(2);
  });
});

describe("T110 分歧防護：已收款卻卡 pending_payment 不得逾期取消", () => {
  it("候選有 paid payment → 跳過取消、diverged 計數、不呼叫 transitionOrder", async () => {
    candidates = [{ id: "o1" }];
    paidPaymentOrderIds = ["o1"]; // webhook 已翻 payment=paid，訂單卻卡 pending

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body).toEqual({
      checked: 1,
      cancelled: 0,
      skipped: 0,
      failed: 0,
      diverged: 1,
    });
    // 錢已收到，絕不可當逾期未付款取消。
    expect(transitionOrder).not.toHaveBeenCalled();
    // 沒取消就不會有 pending→failed 的 payment sweep。
    expect(paymentSweeps).toEqual([]);
  });

  it("混合批次：分歧單跳過、正常逾期單照常取消", async () => {
    candidates = [{ id: "o1" }, { id: "o2" }];
    paidPaymentOrderIds = ["o1"]; // o1 分歧，o2 正常逾期
    transitionOrder.mockResolvedValue(undefined);

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body).toEqual({
      checked: 2,
      cancelled: 1,
      skipped: 0,
      failed: 0,
      diverged: 1,
    });
    expect(transitionOrder).toHaveBeenCalledTimes(1);
    expect(transitionOrder).toHaveBeenCalledWith(
      "o2",
      "cancelled",
      expect.anything(),
    );
  });

  it("paid-payment 檢查失敗（{error}）→ fail-safe：整批中止 500、不取消任何訂單", async () => {
    candidates = [{ id: "o1" }];
    paidCheckError = "connection timeout";

    const res = await GET(buildRequest("Bearer test-cron-secret"));

    expect(res.status).toBe(500);
    // 無法確認哪些已收款時，寧可整批不動，也不冒誤取消已收款訂單的風險。
    expect(transitionOrder).not.toHaveBeenCalled();
  });
});
