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
const { transitionOrder } = vi.hoisted(() => ({
  transitionOrder: vi.fn(),
}));
vi.mock("@/lib/order/state-machine", () => ({
  transitionOrder: (...args: unknown[]) => transitionOrder(...args),
}));

type OrderRow = { id: string };

let candidates: OrderRow[] = [];
let lastFilters: Record<string, unknown> = {};

function makeServiceRole() {
  return {
    from: (table: string) => {
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

    expect(body).toEqual({ checked: 1, cancelled: 1, skipped: 0, failed: 0 });
    expect(transitionOrder).toHaveBeenCalledWith(
      "o1",
      "cancelled",
      expect.objectContaining({ note: expect.any(String) }),
    );
  });

  it("併發：webhook 搶先轉 paid（STALE_TRANSITION）→ skipped 計數，非錯誤", async () => {
    candidates = [{ id: "o1" }];
    transitionOrder.mockRejectedValue(
      Object.assign(new Error("訂單狀態已被其他流程異動：o1"), {
        code: "STALE_TRANSITION",
      }),
    );

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body).toEqual({ checked: 1, cancelled: 0, skipped: 1, failed: 0 });
  });

  it("非預期錯誤 → failed 計數，繼續處理下一筆", async () => {
    candidates = [{ id: "o1" }, { id: "o2" }];
    transitionOrder
      .mockRejectedValueOnce(new Error("DB 連線失敗"))
      .mockResolvedValueOnce(undefined);

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body).toEqual({ checked: 2, cancelled: 1, skipped: 0, failed: 1 });
    expect(transitionOrder).toHaveBeenCalledTimes(2);
  });
});
