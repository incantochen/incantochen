import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

// transitionOrder 整支 mock 掉聚焦編排邏輯（CAS／取消守衛已在
// state-machine.test.ts 覆蓋）；OrderTransitionRaceError 用真的類別，
// refund-order 的 instanceof 分流才驗得到。
const transitionOrderMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/order/state-machine", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, transitionOrder: transitionOrderMock };
});

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { OrderTransitionRaceError } from "../state-machine";
import { refundOrder, NoRefundablePaymentError } from "../refund-order";

type QueryResult<T> = { data: T | null; error: { message: string } | null };

const updateValuesSpy = vi.fn();
const updateEqSpy = vi.fn();
const ordersQuerySpy = vi.fn();

function makeServiceRole(opts: {
  // 存在檢查（payment in paid/refunded）的回傳
  existsResult: QueryResult<{ id: string }>;
  // 條件式 UPDATE 的回傳（预設成功；0 rows 與 1 row 同形——實作不看 count）
  updateResult?: { error: { message: string } | null };
  // RaceError 後複查 orders.status 的回傳
  recheckResult?: QueryResult<{ status: string }>;
}) {
  return {
    from: (table: string) => {
      if (table === "payment") {
        return {
          select: () => {
            const chain = {
              eq: () => chain,
              in: () => chain,
              limit: () => chain,
              maybeSingle: () => Promise.resolve(opts.existsResult),
            };
            return chain;
          },
          update: (values: unknown) => {
            updateValuesSpy(values);
            const chain = {
              eq: (column: string, value: unknown) => {
                updateEqSpy(column, value);
                return chain;
              },
              // 實作直接 await builder：thenable 讓 chain 可被 resolve
              then: (
                resolve: (v: unknown) => unknown,
                reject: (e: unknown) => unknown,
              ) =>
                Promise.resolve(opts.updateResult ?? { error: null }).then(
                  resolve,
                  reject,
                ),
            };
            return chain;
          },
        };
      }
      if (table === "orders") {
        ordersQuerySpy();
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve(opts.recheckResult ?? { data: null, error: null }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function mockClient(opts: Parameters<typeof makeServiceRole>[0]) {
  vi.mocked(createServiceRoleClient).mockReturnValue(
    makeServiceRole(opts) as unknown as ReturnType<
      typeof createServiceRoleClient
    >,
  );
}

const OPTS = { actorId: "admin-1", reason: "戒台瑕疵，協議全額退款" };

beforeEach(() => {
  transitionOrderMock.mockReset().mockResolvedValue(undefined);
  updateValuesSpy.mockClear();
  updateEqSpy.mockClear();
  ordersQuerySpy.mockClear();
});

describe("refundOrder：存在檢查", () => {
  it("無 paid/refunded payment → NoRefundablePaymentError，不 UPDATE、不轉 orders", async () => {
    mockClient({ existsResult: { data: null, error: null } });

    await expect(refundOrder("order-1", OPTS)).rejects.toBeInstanceOf(
      NoRefundablePaymentError,
    );
    expect(updateValuesSpy).not.toHaveBeenCalled();
    expect(transitionOrderMock).not.toHaveBeenCalled();
  });

  it("存在檢查 {error}（DB 暫時性故障）→ throw 不吞，不得誤判成「沒收過款」", async () => {
    mockClient({
      existsResult: { data: null, error: { message: "connection timeout" } },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow(
      "退款前查詢 payment 失敗",
    );
    expect(updateValuesSpy).not.toHaveBeenCalled();
    expect(transitionOrderMock).not.toHaveBeenCalled();
  });
});

describe("refundOrder：payment 翻面＋orders 轉換", () => {
  it("happy path：條件式 UPDATE 帶 order_id＋status='paid' 守衛，transitionOrder 收到 note=reason 與 actorId", async () => {
    mockClient({ existsResult: { data: { id: "pay-1" }, error: null } });

    await refundOrder("order-1", OPTS);

    expect(updateValuesSpy).toHaveBeenCalledWith({ status: "refunded" });
    expect(updateEqSpy).toHaveBeenCalledWith("order_id", "order-1");
    expect(updateEqSpy).toHaveBeenCalledWith("status", "paid");
    expect(transitionOrderMock).toHaveBeenCalledWith("order-1", "refunded", {
      actorId: "admin-1",
      note: "戒台瑕疵，協議全額退款",
    });
  });

  it("payment 已全 refunded（UPDATE 影響 0 列）→ 不當失敗，照樣轉 orders（冪等重試）", async () => {
    // 存在檢查撈到 refunded 那筆；UPDATE WHERE status='paid' 影響 0 列＝
    // resolve { error: null }，與 1 列同形——實作不看 count，走到 orders 轉換。
    mockClient({ existsResult: { data: { id: "pay-1" }, error: null } });

    await refundOrder("order-1", OPTS);

    expect(transitionOrderMock).toHaveBeenCalledWith(
      "order-1",
      "refunded",
      expect.anything(),
    );
  });

  it("UPDATE {error} → throw 不吞，不轉 orders", async () => {
    mockClient({
      existsResult: { data: { id: "pay-1" }, error: null },
      updateResult: { error: { message: "connection timeout" } },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow(
      "payment 標記 refunded 失敗",
    );
    expect(transitionOrderMock).not.toHaveBeenCalled();
  });
});

describe("refundOrder：transitionOrder 錯誤分流", () => {
  it("RaceError＋複查現況=refunded → 冪等成功不噴錯", async () => {
    mockClient({
      existsResult: { data: { id: "pay-1" }, error: null },
      recheckResult: { data: { status: "refunded" }, error: null },
    });
    transitionOrderMock.mockRejectedValue(
      new OrderTransitionRaceError("非法狀態轉換：refunded → refunded"),
    );

    await expect(refundOrder("order-1", OPTS)).resolves.toBeUndefined();
  });

  it("RaceError 但複查現況非 refunded（被別的流程搶走）→ rethrow 原錯誤", async () => {
    mockClient({
      existsResult: { data: { id: "pay-1" }, error: null },
      recheckResult: { data: { status: "cancelled" }, error: null },
    });
    const raceError = new OrderTransitionRaceError("已被其他流程異動");
    transitionOrderMock.mockRejectedValue(raceError);

    await expect(refundOrder("order-1", OPTS)).rejects.toBe(raceError);
  });

  it("RaceError＋複查 {error} → throw 複查失敗，不得假設現況已是 refunded", async () => {
    mockClient({
      existsResult: { data: { id: "pay-1" }, error: null },
      recheckResult: { data: null, error: { message: "connection timeout" } },
    });
    transitionOrderMock.mockRejectedValue(
      new OrderTransitionRaceError("已被其他流程異動"),
    );

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow(
      "退款後複查訂單狀態失敗",
    );
  });

  it("transitionOrder 丟一般 Error（非 RaceError）→ 原樣上拋、不吞、不複查", async () => {
    mockClient({ existsResult: { data: { id: "pay-1" }, error: null } });
    const dbError = new Error("訂單狀態更新失敗：connection timeout");
    transitionOrderMock.mockRejectedValue(dbError);

    await expect(refundOrder("order-1", OPTS)).rejects.toBe(dbError);
    // 一般錯誤不得進入冪等複查分支（那條只屬於 RaceError）。
    expect(ordersQuerySpy).not.toHaveBeenCalled();
  });
});
