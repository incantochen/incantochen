import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  canTransition,
  transitionOrder,
  adminOverrideStatus,
  VALID_TRANSITIONS,
  OrderTransitionRaceError,
  type OrderStatus,
} from "../state-machine";

// T110 後兩函式的寫入段都走 transition_order_status RPC（CAS UPDATE + log
// INSERT 在 DB 端同一交易），mock 骨架共用：orders 只剩前置的狀態查詢，寫入
// 全看 rpc 的回傳。rpcCall 記錄參數供斷言。
const rpcCall = vi.fn();

// 三個 knob 互斥使用：rpcErrorMessage（RPC 回 {error}）優先於 updateMatches
// （CAS 是否搶到，預設 true=搶到）。
function makeServiceRole(opts: {
  initialStatus: OrderStatus;
  updateMatches?: boolean;
  rpcErrorMessage?: string;
}) {
  return {
    from: (table: string) => {
      if (table === "orders") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: { status: opts.initialStatus },
              error: null,
            }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name !== "transition_order_status") {
        throw new Error(`unexpected rpc ${name}`);
      }
      rpcCall(args);
      const result = Promise.resolve(
        opts.rpcErrorMessage
          ? { data: null, error: { message: opts.rpcErrorMessage } }
          : (opts.updateMatches ?? true)
            ? { data: { id: "order-1" }, error: null }
            : { data: null, error: null },
      );
      // 實作鏈 .select("id").maybeSingle()；select 回傳同一 chain。
      const chain = {
        select: () => chain,
        maybeSingle: () => result,
      };
      return chain;
    },
  };
}

beforeEach(() => {
  rpcCall.mockClear();
});

describe("canTransition", () => {
  it("允許正常流程的每一條合法轉換", () => {
    const cases: [OrderStatus, OrderStatus][] = [
      ["pending_payment", "paid"],
      ["pending_payment", "cancelled"],
      ["paid", "in_production"],
      ["paid", "refunded"],
      ["in_production", "shipped"],
      ["in_production", "refunded"],
      ["shipped", "completed"],
      ["shipped", "refunded"],
    ];
    for (const [from, to] of cases) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it("拒絕非法轉換", () => {
    const cases: [OrderStatus, OrderStatus][] = [
      ["paid", "cancelled"], // 付款後不可直接取消，須走 refunded
      ["pending_payment", "refunded"],
      ["pending_payment", "in_production"],
      ["in_production", "paid"],
      ["completed", "paid"],
      ["cancelled", "pending_payment"],
      ["refunded", "paid"],
    ];
    for (const [from, to] of cases) {
      expect(canTransition(from, to), `${from} → ${to} 應被拒絕`).toBe(false);
    }
  });

  it("任何狀態都不得列出自身為合法轉換（自環會讓 RPC 的 from=to 例外從不可達變成可達，且被誤分類為一般錯誤而非競態）", () => {
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      expect(targets, `${from} 不得自環`).not.toContain(from);
    }
  });

  it("終止狀態無任何出口", () => {
    const terminals: OrderStatus[] = ["completed", "cancelled", "refunded"];
    const allStatuses = Object.keys(VALID_TRANSITIONS) as OrderStatus[];
    for (const terminal of terminals) {
      for (const to of allStatuses) {
        expect(
          canTransition(terminal, to),
          `${terminal} → ${to} 應被拒絕`,
        ).toBe(false);
      }
    }
  });
});

describe("transitionOrder：CAS 守衛", () => {
  it("併發：cron 判定 pending_payment 期間 webhook 搶先轉 paid → CAS 沒搶到（RPC 回空），丟出 OrderTransitionRaceError", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "pending_payment",
        updateMatches: false,
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await expect(
      transitionOrder("order-1", "cancelled"),
    ).rejects.toBeInstanceOf(OrderTransitionRaceError);
    // CAS 沒搶到時不寫 log 的保證已移進 RPC 交易本身（0017），TS 端只驗錯誤分類。
  });

  it("正常轉換：CAS 搶到 → RPC 收到正確的 from/to/note，is_override 為 false", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "pending_payment",
        updateMatches: true,
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await transitionOrder("order-1", "cancelled", {
      note: "逾期未付款自動取消",
    });

    expect(rpcCall).toHaveBeenCalledWith(
      expect.objectContaining({
        p_order_id: "order-1",
        p_from: "pending_payment",
        p_to: "cancelled",
        p_note: "逾期未付款自動取消",
        p_is_override: false,
      }),
    );
  });

  it("RPC 回傳 error（DB 暫時性故障或 log 寫入失敗 rollback）→ throw，不得靜默", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "pending_payment",
        rpcErrorMessage: "connection timeout",
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await expect(transitionOrder("order-1", "cancelled")).rejects.toThrow(
      "訂單狀態更新失敗",
    );
  });
});

describe("adminOverrideStatus：CAS 守衛（T92／F-007）", () => {
  it("to === from：拒絕、完全不呼叫 RPC（CAS 守衛在此 edge case 對並發無效，改用前置擋下）", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "paid",
        updateMatches: true,
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await expect(
      adminOverrideStatus("order-1", "paid", {
        operatorId: "admin-1",
        reason: "測試",
      }),
    ).rejects.toThrow("目標狀態與目前狀態相同");
    expect(rpcCall).not.toHaveBeenCalled();
  });

  it("併發：兩位管理者近乎同時對同一單送出互斥的 override 目標 → 沒搶到 CAS 的丟出 OrderTransitionRaceError", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "paid",
        updateMatches: false,
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await expect(
      adminOverrideStatus("order-1", "refunded", {
        operatorId: "admin-1",
        reason: "測試",
      }),
    ).rejects.toBeInstanceOf(OrderTransitionRaceError);
  });

  it("正常 override：CAS 搶到 → RPC 收到 is_override true 與 operator/reason", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "paid",
        updateMatches: true,
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await adminOverrideStatus("order-1", "refunded", {
      operatorId: "admin-1",
      reason: "客訴協議退款",
    });

    expect(rpcCall).toHaveBeenCalledWith(
      expect.objectContaining({
        p_order_id: "order-1",
        p_from: "paid",
        p_to: "refunded",
        p_note: "客訴協議退款",
        p_actor_id: "admin-1",
        p_is_override: true,
      }),
    );
  });

  it("RPC 回傳 error → throw，不得靜默", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "paid",
        rpcErrorMessage: "connection timeout",
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await expect(
      adminOverrideStatus("order-1", "refunded", {
        operatorId: "admin-1",
        reason: "測試",
      }),
    ).rejects.toThrow("訂單狀態更新失敗");
  });
});
