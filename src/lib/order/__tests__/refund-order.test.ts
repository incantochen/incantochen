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
  data: unknown;
  error: { message: string; code?: string } | null;
};

const rpcSpy = vi.fn();

function makeServiceRole(opts: {
  // fetchCurrentStatus（pre-guard）讀 orders.status
  orderStatus: QueryResult<{ status: OrderStatus }>;
  // findRefundablePayment：payment in ('paid','refunded') 存在性
  existsResult?: QueryResult<{ id: string }>;
  // 一般路徑：refund_order RPC → .select("id").maybeSingle()
  refundRpc?: { data: { id: string } | null; error: { message: string; code?: string } | null };
  // repair 路徑：repair_refunded_payment RPC → 直接 await {data, error}
  repairRpc?: RpcResult;
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
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string, args: unknown) => {
      rpcSpy(name, args);
      if (name === "repair_refunded_payment") {
        // TS 端直接 await → {data, error}
        return Promise.resolve(opts.repairRpc ?? { data: 1, error: null });
      }
      // refund_order：.select("id").maybeSingle()
      return {
        select: () => ({
          maybeSingle: () =>
            Promise.resolve(
              opts.refundRpc ?? { data: { id: "order-1" }, error: null },
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
});

describe("refundOrder：pre-guard（動任何寫入之前擋不可退款的訂單狀態）", () => {
  it.each<OrderStatus>(["pending_payment", "cancelled"])(
    "訂單狀態 %s → OrderNotRefundableError，不呼叫任何 RPC",
    async (status) => {
      mockClient({ orderStatus: ok({ status }) });

      await expect(refundOrder("order-1", OPTS)).rejects.toBeInstanceOf(
        OrderNotRefundableError,
      );
      expect(rpcSpy).not.toHaveBeenCalled();
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
  it("happy path：以 p_from=現況、p_note=reason、p_actor_id 呼叫 refund_order", async () => {
    mockClient({
      orderStatus: ok({ status: "paid" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      refundRpc: { data: { id: "order-1" }, error: null },
    });

    await refundOrder("order-1", OPTS);

    expect(rpcSpy).toHaveBeenCalledWith("refund_order", {
      p_order_id: "order-1",
      p_from: "paid",
      p_note: "戒台瑕疵，協議全額退款",
      p_actor_id: "admin-1",
    });
  });

  it.each<OrderStatus>(["in_production", "shipped", "completed"])(
    "可退款狀態 %s → 進 refund_order（含 completed→refunded）",
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

  it("refund_order error code U0002（CAS 未命中）→ OrderTransitionRaceError", async () => {
    mockClient({
      orderStatus: ok({ status: "paid" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      refundRpc: { data: null, error: { message: "CAS 未命中", code: "U0002" } },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toBeInstanceOf(
      OrderTransitionRaceError,
    );
  });

  it("refund_order 一般 error（DB 故障）→ throw「退款交易失敗」，不吞", async () => {
    mockClient({
      orderStatus: ok({ status: "paid" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      refundRpc: {
        data: null,
        error: { message: "connection timeout", code: "57014" },
      },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow("退款交易失敗");
  });

  it("refund_order 成功卻回 data=null（非預期）→ 保守當競態，不誤報成功", async () => {
    mockClient({
      orderStatus: ok({ status: "paid" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      refundRpc: { data: null, error: null },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toBeInstanceOf(
      OrderTransitionRaceError,
    );
  });
});

describe("refundOrder：repair 路徑（訂單已 refunded，原子補翻殘留 payment）", () => {
  it("Override 半套 → 呼叫 repair_refunded_payment，note 含 [退款補登記] 前綴，不呼叫 refund_order", async () => {
    mockClient({
      orderStatus: ok({ status: "refunded" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      repairRpc: { data: 1, error: null },
    });

    await refundOrder("order-1", OPTS);

    expect(rpcSpy).toHaveBeenCalledWith("repair_refunded_payment", {
      p_order_id: "order-1",
      p_note: "[退款補登記] 戒台瑕疵，協議全額退款",
      p_actor_id: "admin-1",
    });
    // repair 不走一般轉換路徑
    expect(rpcSpy).not.toHaveBeenCalledWith(
      "refund_order",
      expect.anything(),
    );
  });

  it("repair RPC error → throw「退款補登記失敗」，不吞", async () => {
    mockClient({
      orderStatus: ok({ status: "refunded" as OrderStatus }),
      existsResult: ok({ id: "pay-1" }),
      repairRpc: { data: null, error: { message: "connection timeout" } },
    });

    await expect(refundOrder("order-1", OPTS)).rejects.toThrow(
      "退款補登記失敗",
    );
  });
});
