import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { OrderTransitionRaceError } from "../state-machine";
import {
  refundOrder,
  NoRefundablePaymentError,
  OrderNotRefundableError,
} from "../refund-order";
import type { OrderStatus } from "../order-status";

type QueryResult<T> = { data: T | null; error: { message: string } | null };
type RpcResult = {
  data: { id: string } | null;
  error: { message: string; code?: string } | null;
};

const rpcSpy = vi.fn();
const paymentUpdateValuesSpy = vi.fn();
const paymentUpdateEqSpy = vi.fn();
const logInsertSpy = vi.fn();

function makeServiceRole(opts: {
  // fetchCurrentStatus（pre-guard）讀 orders.status
  orderStatus: QueryResult<{ status: OrderStatus }>;
  // findRefundablePayment：payment in ('paid','refunded') 存在性
  existsResult?: QueryResult<{ id: string }>;
  // repair 路徑：payment UPDATE ... .select("id") 回傳被翻的列（陣列）
  repairUpdate?: { data: { id: string }[] | null; error: { message: string } | null };
  // repair 路徑：order_status_log insert
  logInsert?: { error: { message: string } | null };
  // 一般路徑：refund_order RPC → .select("id").maybeSingle()
  rpcResult?: RpcResult;
}) {
  return {
    from: (table: string) => {
      if (table === "orders") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve(opts.orderStatus),
        };
        return chain;
      }
      if (table === "payment") {
        return {
          // findRefundablePayment
          select: () => {
            const chain = {
              eq: () => chain,
              in: () => chain,
              limit: () => chain,
              maybeSingle: () =>
                Promise.resolve(opts.existsResult ?? { data: null, error: null }),
            };
            return chain;
          },
          // repair 路徑條件式 UPDATE ... .select("id")
          update: (values: unknown) => {
            paymentUpdateValuesSpy(values);
            const chain = {
              eq: (column: string, value: unknown) => {
                paymentUpdateEqSpy(column, value);
                return chain;
              },
              select: () =>
                Promise.resolve(
                  opts.repairUpdate ?? { data: [{ id: "pay-1" }], error: null },
                ),
            };
            return chain;
          },
        };
      }
      if (table === "order_status_log") {
        return {
          insert: (row: unknown) => {
            logInsertSpy(row);
            return Promise.resolve(opts.logInsert ?? { error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string, args: unknown) => {
      rpcSpy(name, args);
      return {
        select: () => ({
          maybeSingle: () =>
            Promise.resolve(
              opts.rpcResult ?? { data: { id: "order-1" }, error: null },
            ),
        }),
      };
    },
  };
}

function mockClient(opts: Parameters<typeof makeServiceRole>[0]) {
  vi.mocked(createServiceRoleClient).mockReturnValue(
    makeServiceRole(opts) as unknown as ReturnType<typeof createServiceRoleClient>,
  );
}

const ok = <T>(data: T): QueryResult<T> => ({ data, error: null });
const OPTS = { actorId: "admin-1", reason: "戒台瑕疵，協議全額退款" };

beforeEach(() => {
  rpcSpy.mockClear();
  paymentUpdateValuesSpy.mockClear();
  paymentUpdateEqSpy.mockClear();
  logInsertSpy.mockClear();
});

describe("refundOrder：pre-guard（動任何寫入之前擋不可退款的訂單狀態）", () => {
  it.each<OrderStatus>(["pending_payment", "cancelled"])(
    "訂單狀態 %s → OrderNotRefundableError，不呼叫 RPC、不動 payment",
    async (status) => {
      mockClient({ orderStatus: ok({ status }) });

      await expect(refundOrder("order-1", OPTS)).rejects.toBeInstanceOf(
        OrderNotRefundableError,
      );
      expect(rpcSpy).not.toHaveBeenCalled();
      expect(paymentUpdateValuesSpy).not.toHaveBeenCalled();
    },
  );

  it("pre-guard 讀取 {error}（DB 暫時性故障）→ throw 不吞（fetchCurrentStatus 契約）", async () => {
    mockClient({
      orderStatus: { data: null, error: { message: "connection timeout" } },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow("訂單查詢失敗");
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe("refundOrder：存在檢查（findRefundablePayment）", () => {
  it("無 paid/refunded payment → NoRefundablePaymentError，不呼叫 RPC", async () => {
    mockClient({
      orderStatus: ok({ status: "paid" as OrderStatus }),
      existsResult: { data: null, error: null },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toBeInstanceOf(
      NoRefundablePaymentError,
    );
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("存在檢查 {error} → throw 不吞，不得誤判成「沒收過款」", async () => {
    mockClient({
      orderStatus: ok({ status: "paid" as OrderStatus }),
      existsResult: { data: null, error: { message: "connection timeout" } },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow(
      "findRefundablePayment failed",
    );
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe("refundOrder：一般路徑（原子 refund_order RPC）", () => {
  it("happy path：以 p_from=現況、p_note=reason、p_actor_id 呼叫 refund_order RPC", async () => {
    mockClient({
      orderStatus: ok({ status: "paid" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      rpcResult: { data: { id: "order-1" }, error: null },
    });

    await refundOrder("order-1", OPTS);

    expect(rpcSpy).toHaveBeenCalledWith("refund_order", {
      p_order_id: "order-1",
      p_from: "paid",
      p_note: "戒台瑕疵，協議全額退款",
      p_actor_id: "admin-1",
    });
    // 原子 RPC 取代了 TS 端手動翻 payment：一般路徑不直接 UPDATE payment。
    expect(paymentUpdateValuesSpy).not.toHaveBeenCalled();
  });

  it.each<OrderStatus>(["in_production", "shipped", "completed"])(
    "可退款狀態 %s → 進 RPC（含 completed→refunded）",
    async (status) => {
      mockClient({
        orderStatus: ok({ status }),
        existsResult: ok({ id: "pay-1" }),
      });

      await refundOrder("order-1", OPTS);

      expect(rpcSpy).toHaveBeenCalledWith(
        "refund_order",
        expect.objectContaining({ p_from: status }),
      );
    },
  );

  it("RPC error code U0002（CAS 未命中）→ OrderTransitionRaceError", async () => {
    mockClient({
      orderStatus: ok({ status: "paid" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      rpcResult: { data: null, error: { message: "CAS 未命中", code: "U0002" } },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toBeInstanceOf(
      OrderTransitionRaceError,
    );
  });

  it("RPC 一般 error（DB 故障）→ throw「退款交易失敗」，不吞", async () => {
    mockClient({
      orderStatus: ok({ status: "paid" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      rpcResult: {
        data: null,
        error: { message: "connection timeout", code: "57014" },
      },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow("退款交易失敗");
  });

  it("RPC 成功卻回 data=null（非預期）→ 保守當競態，不誤報成功", async () => {
    mockClient({
      orderStatus: ok({ status: "paid" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      rpcResult: { data: null, error: null },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toBeInstanceOf(
      OrderTransitionRaceError,
    );
  });
});

describe("refundOrder：repair 路徑（訂單已 refunded，補翻殘留 payment）", () => {
  it("Override 半套（order=refunded ∧ payment=paid）→ 補翻 payment＋落 reason 稽核 log，不呼叫 RPC", async () => {
    mockClient({
      orderStatus: ok({ status: "refunded" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      repairUpdate: { data: [{ id: "pay-1" }], error: null },
    });

    await refundOrder("order-1", OPTS);

    expect(paymentUpdateValuesSpy).toHaveBeenCalledWith({ status: "refunded" });
    expect(paymentUpdateEqSpy).toHaveBeenCalledWith("order_id", "order-1");
    expect(paymentUpdateEqSpy).toHaveBeenCalledWith("status", "paid");
    // 補上 UI 承諾的稽核：reason 落進 order_status_log note。
    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: "order-1",
        note: expect.stringContaining("戒台瑕疵，協議全額退款"),
        is_override: true,
      }),
    );
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("已完全一致（payment 早已 refunded，UPDATE 0 列）→ 不寫稽核 log（避免重複點擊灌 log）", async () => {
    mockClient({
      orderStatus: ok({ status: "refunded" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      repairUpdate: { data: [], error: null },
    });

    await refundOrder("order-1", OPTS);

    expect(logInsertSpy).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("repair 的 payment UPDATE {error} → throw 不吞", async () => {
    mockClient({
      orderStatus: ok({ status: "refunded" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      repairUpdate: { data: null, error: { message: "connection timeout" } },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow(
      "payment 補翻 refunded 失敗",
    );
    expect(logInsertSpy).not.toHaveBeenCalled();
  });
});
