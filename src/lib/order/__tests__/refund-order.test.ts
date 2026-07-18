import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const sentryCaptureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
  captureException: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

// transitionOrder 整支 mock 掉聚焦編排邏輯（CAS／守衛已在 state-machine.test.ts
// 覆蓋）；fetchCurrentStatus／OrderTransitionRaceError 用真的實作，refund-order
// 的 pre-guard 讀取與 instanceof 分流才驗得到。
const transitionOrderMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/order/state-machine", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, transitionOrder: transitionOrderMock };
});

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { OrderTransitionRaceError } from "../state-machine";
import {
  refundOrder,
  NoRefundablePaymentError,
  OrderNotRefundableError,
} from "../refund-order";
import type { OrderStatus } from "../order-status";

type QueryResult<T> = { data: T | null; error: { message: string } | null };

const updateValuesSpy = vi.fn();
const updateEqSpy = vi.fn();
const ordersQuerySpy = vi.fn();

function makeServiceRole(opts: {
  // orders.status 讀取依序回傳：第 1 次＝pre-guard（fetchCurrentStatus）、
  // 第 2 次＝RaceError 後的冪等複查。
  ordersResults: QueryResult<{ status: OrderStatus }>[];
  // 存在檢查（payment in paid/refunded）的回傳
  existsResult?: QueryResult<{ id: string }>;
  // 條件式 UPDATE 的回傳（預設成功；0 rows 與 1 row 同形——實作不看 count）
  updateResult?: { error: { message: string } | null };
}) {
  const ordersQueue = [...opts.ordersResults];
  return {
    from: (table: string) => {
      if (table === "payment") {
        return {
          select: () => {
            const chain = {
              eq: () => chain,
              in: () => chain,
              limit: () => chain,
              maybeSingle: () =>
                Promise.resolve(
                  opts.existsResult ?? { data: null, error: null },
                ),
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
            Promise.resolve(ordersQueue.shift() ?? { data: null, error: null }),
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

const ok = <T>(data: T): QueryResult<T> => ({ data, error: null });
const OPTS = { actorId: "admin-1", reason: "戒台瑕疵，協議全額退款" };

beforeEach(() => {
  transitionOrderMock.mockReset().mockResolvedValue(undefined);
  updateValuesSpy.mockClear();
  updateEqSpy.mockClear();
  ordersQuerySpy.mockClear();
  sentryCaptureMessage.mockClear();
});

describe("refundOrder：pre-guard（動 payment 之前擋不可退款的訂單狀態）", () => {
  it.each<OrderStatus>(["pending_payment", "cancelled"])(
    "訂單狀態 %s → OrderNotRefundableError，payment 完全不動（防翻了 payment 卻卡死＋滅稽核信號）",
    async (status) => {
      mockClient({ ordersResults: [ok({ status })] });

      await expect(refundOrder("order-1", OPTS)).rejects.toBeInstanceOf(
        OrderNotRefundableError,
      );
      expect(updateValuesSpy).not.toHaveBeenCalled();
      expect(transitionOrderMock).not.toHaveBeenCalled();
    },
  );

  it("pre-guard 讀取 {error}（DB 暫時性故障）→ throw 不吞（fetchCurrentStatus 契約）", async () => {
    mockClient({
      ordersResults: [{ data: null, error: { message: "connection timeout" } }],
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow("訂單查詢失敗");
    expect(updateValuesSpy).not.toHaveBeenCalled();
  });
});

describe("refundOrder：存在檢查", () => {
  it("無 paid/refunded payment → NoRefundablePaymentError，不 UPDATE、不轉 orders", async () => {
    mockClient({
      ordersResults: [ok({ status: "paid" as OrderStatus })],
      existsResult: { data: null, error: null },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toBeInstanceOf(
      NoRefundablePaymentError,
    );
    expect(updateValuesSpy).not.toHaveBeenCalled();
    expect(transitionOrderMock).not.toHaveBeenCalled();
  });

  it("存在檢查 {error}（DB 暫時性故障）→ throw 不吞，不得誤判成「沒收過款」", async () => {
    mockClient({
      ordersResults: [ok({ status: "paid" as OrderStatus })],
      existsResult: { data: null, error: { message: "connection timeout" } },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow(
      "退款前查詢 payment 失敗",
    );
    expect(updateValuesSpy).not.toHaveBeenCalled();
  });
});

describe("refundOrder：payment 翻面＋orders 轉換", () => {
  it("happy path：條件式 UPDATE 帶 order_id＋status='paid' 守衛，transitionOrder 收到 note=reason 與 actorId", async () => {
    mockClient({
      ordersResults: [ok({ status: "paid" as OrderStatus })],
      existsResult: ok({ id: "pay-1" }),
    });

    await refundOrder("order-1", OPTS);

    expect(updateValuesSpy).toHaveBeenCalledWith({ status: "refunded" });
    expect(updateEqSpy).toHaveBeenCalledWith("order_id", "order-1");
    expect(updateEqSpy).toHaveBeenCalledWith("status", "paid");
    expect(transitionOrderMock).toHaveBeenCalledWith("order-1", "refunded", {
      actorId: "admin-1",
      note: "戒台瑕疵，協議全額退款",
    });
  });

  it("UPDATE 影響 0 列（並發已翻走）→ 不當失敗，照樣轉 orders（冪等）", async () => {
    // 0 rows 與 1 row 對 supabase-js 同形（error: null）；實作不看 count。
    mockClient({
      ordersResults: [ok({ status: "paid" as OrderStatus })],
      existsResult: ok({ id: "pay-1" }),
    });

    await refundOrder("order-1", OPTS);

    expect(transitionOrderMock).toHaveBeenCalledWith(
      "order-1",
      "refunded",
      expect.anything(),
    );
  });

  it("UPDATE {error} → throw 不吞，不轉 orders", async () => {
    mockClient({
      ordersResults: [ok({ status: "paid" as OrderStatus })],
      existsResult: ok({ id: "pay-1" }),
      updateResult: { error: { message: "connection timeout" } },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow(
      "payment 標記 refunded 失敗",
    );
    expect(transitionOrderMock).not.toHaveBeenCalled();
  });

  it("訂單已 refunded（Override 半套狀態／中斷重試）→ 補翻 payment、跳過狀態轉換", async () => {
    mockClient({
      ordersResults: [ok({ status: "refunded" as OrderStatus })],
      existsResult: ok({ id: "pay-1" }),
    });

    await refundOrder("order-1", OPTS);

    // payment 補翻有跑（Override 留下的 paid 列在此收斂）……
    expect(updateValuesSpy).toHaveBeenCalledWith({ status: "refunded" });
    // ……但不再轉 orders（已是 refunded，避免重複稽核 log／RaceError 噪音）。
    expect(transitionOrderMock).not.toHaveBeenCalled();
  });
});

describe("refundOrder：transitionOrder 錯誤分流", () => {
  it("RaceError＋複查現況=refunded（並發退款重入）→ 冪等成功不噴錯", async () => {
    mockClient({
      ordersResults: [
        ok({ status: "paid" as OrderStatus }),
        ok({ status: "refunded" as OrderStatus }),
      ],
      existsResult: ok({ id: "pay-1" }),
    });
    transitionOrderMock.mockRejectedValue(
      new OrderTransitionRaceError("非法狀態轉換：refunded → refunded"),
    );

    await expect(refundOrder("order-1", OPTS)).resolves.toBeUndefined();
    expect(sentryCaptureMessage).not.toHaveBeenCalled();
  });

  it("RaceError 但複查現況非 refunded（payment 已翻、訂單被搶走）→ rethrow 原錯誤＋Sentry error 告警", async () => {
    mockClient({
      ordersResults: [
        ok({ status: "paid" as OrderStatus }),
        ok({ status: "cancelled" as OrderStatus }),
      ],
      existsResult: ok({ id: "pay-1" }),
    });
    const raceError = new OrderTransitionRaceError("已被其他流程異動");
    transitionOrderMock.mockRejectedValue(raceError);

    await expect(refundOrder("order-1", OPTS)).rejects.toBe(raceError);
    // 殘餘 TOCTOU：payment=refunded ∧ orders≠refunded 是金流矛盾態，必須
    // 留下 P0 級訊號供人工裁決（ops-runbook §6.1），不得靜默。
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "refundOrder: payment flipped to refunded but order transition lost race",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("RaceError＋複查 {error} → throw 複查失敗，不得假設現況已是 refunded", async () => {
    mockClient({
      ordersResults: [
        ok({ status: "paid" as OrderStatus }),
        { data: null, error: { message: "connection timeout" } },
      ],
      existsResult: ok({ id: "pay-1" }),
    });
    transitionOrderMock.mockRejectedValue(
      new OrderTransitionRaceError("已被其他流程異動"),
    );

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow("訂單查詢失敗");
  });

  it("transitionOrder 丟一般 Error（非 RaceError）→ 原樣上拋、不吞、不複查", async () => {
    mockClient({
      ordersResults: [ok({ status: "paid" as OrderStatus })],
      existsResult: ok({ id: "pay-1" }),
    });
    const dbError = new Error("訂單狀態更新失敗：connection timeout");
    transitionOrderMock.mockRejectedValue(dbError);

    await expect(refundOrder("order-1", OPTS)).rejects.toBe(dbError);
    // 一般錯誤不得進入冪等複查分支：orders 只在 pre-guard 讀過一次。
    expect(ordersQuerySpy).toHaveBeenCalledTimes(1);
  });
});
