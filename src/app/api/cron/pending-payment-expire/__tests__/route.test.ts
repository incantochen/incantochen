/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    CRON_SECRET: "test-cron-secret",
  },
}));

// transitionOrder 的行為（CAS 守衛、canTransition、取消守衛＝有 paid payment
// 就丟 PaidOrderCancelBlockedError、TOCTOU 再查與 log 寫入）已在
// state-machine.test.ts 完整覆蓋；這裡當依賴邊界整個 mock 掉，專注在這支
// route 自己的批次處理與計數邏輯。
const {
  transitionOrder,
  OrderTransitionRaceError,
  PaidOrderCancelBlockedError,
} = vi.hoisted(() => {
  class OrderTransitionRaceError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "OrderTransitionRaceError";
    }
  }
  class PaidOrderCancelBlockedError extends Error {
    constructor(orderId: string) {
      super(`訂單已有已收款 payment，不得取消：${orderId}`);
      this.name = "PaidOrderCancelBlockedError";
    }
  }
  return {
    transitionOrder: vi.fn(),
    OrderTransitionRaceError,
    PaidOrderCancelBlockedError,
  };
});
vi.mock("@/lib/order/state-machine", () => ({
  transitionOrder: (...args: unknown[]) => transitionOrder(...args),
  OrderTransitionRaceError,
  PaidOrderCancelBlockedError,
}));

type OrderRow = { id: string };
type Summary = {
  checked: number;
  cancelled: number;
  skipped: number;
  failed: number;
  paidConflict: number;
};

// 全零摘要工廠：每條斷言只寫它真正在意的欄位，其餘留預設 0，
// 新增欄位時不必逐處手改一堆 literal（C-S5）。
function fullSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    checked: 0,
    cancelled: 0,
    skipped: 0,
    failed: 0,
    paidConflict: 0,
    ...overrides,
  };
}

let candidates: OrderRow[] = [];
let lastFilters: Record<string, unknown> = {};
// 取消成功後順帶把該訂單的 pending payment 標 failed 的呼叫記錄。payment 表
// 現在只剩這一種形狀（取消前防呆與 post-cancel 再查都已下沉到 transitionOrder）。
const paymentSweeps: { order_id: unknown }[] = [];

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table === "payment") {
        const filters: Record<string, unknown> = {};
        // payment 表只剩取消後 pending→failed sweep 一種形狀（取消前防呆與
        // post-cancel 再查都已下沉到 transitionOrder，本檔 mock 掉）。
        const chain: any = {
          update: () => chain,
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return chain;
          },
          then: (resolve: (v: unknown) => void) => {
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
    expect(await res.json()).toEqual(fullSummary());
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

    expect(body).toEqual(fullSummary({ checked: 1, cancelled: 1 }));
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

    expect(body).toEqual(fullSummary({ checked: 1, skipped: 1 }));
  });

  it("候選已有 paid payment（守衛擋下）→ skip 取消、paidConflict 計數、不掃 payment", async () => {
    candidates = [{ id: "o1" }, { id: "o2" }];
    // o1 錢已收（webhook 側卡單）：transitionOrder 的取消守衛丟
    // PaidOrderCancelBlockedError，route 計 paidConflict、交給 reconcile 漂移
    // 臂自癒；o2 正常取消。
    transitionOrder.mockImplementation(async (orderId: string) => {
      if (orderId === "o1") throw new PaidOrderCancelBlockedError("o1");
      return undefined;
    });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body).toEqual(
      fullSummary({ checked: 2, cancelled: 1, paidConflict: 1 }),
    );
    expect(transitionOrder).toHaveBeenCalledTimes(2);
    expect(transitionOrder).toHaveBeenCalledWith(
      "o2",
      "cancelled",
      expect.objectContaining({ note: expect.any(String) }),
    );
    // 只有成功取消的 o2 掃 payment；被守衛擋下的 o1 不掃。
    expect(paymentSweeps).toEqual([{ order_id: "o2" }]);
  });

  it("非預期錯誤 → failed 計數，繼續處理下一筆（零星單筆失敗維持 200）", async () => {
    candidates = [{ id: "o1" }, { id: "o2" }];
    transitionOrder
      .mockRejectedValueOnce(new Error("DB 連線失敗"))
      .mockResolvedValueOnce(undefined);

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    // failed(1) < checked(2)：零星單筆，不誤報整批不健康。
    expect(res.status).toBe(200);
    expect(body).toEqual(fullSummary({ checked: 2, cancelled: 1, failed: 1 }));
    expect(transitionOrder).toHaveBeenCalledTimes(2);
  });

  it("整批候選全數失敗（系統性故障）→ 回 500（fail-visible，取代原批次 paid 查詢 throw）", async () => {
    // 守衛查詢在 transitionOrder 內：DB 故障時每筆都 throw → failed===checked。
    candidates = [{ id: "o1" }, { id: "o2" }];
    transitionOrder.mockRejectedValue(new Error("DB 連線池耗盡"));

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual(fullSummary({ checked: 2, failed: 2 }));
  });

  it("單筆候選失敗 → 維持 200（不把 1===1 誤判成系統性故障；checked>1 門檻）", async () => {
    // 反向驗證：門檻若退回 checked>0，這條會轉紅。單筆的暫時性錯誤不算
    // 系統性故障，避免一張逾期單踩到一個 blip 就 page on-call。
    candidates = [{ id: "o1" }];
    transitionOrder.mockRejectedValue(new Error("暫時性 DB blip"));

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(fullSummary({ checked: 1, failed: 1 }));
  });
});

