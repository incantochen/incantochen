import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

const sentryCaptureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
}));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  canTransition,
  transitionOrder,
  adminOverrideStatus,
  VALID_TRANSITIONS,
  OrderTransitionRaceError,
  PaidOrderCancelBlockedError,
  type OrderStatus,
} from "../state-machine";

// T110 後兩函式的寫入段都走 transition_order_status RPC（CAS UPDATE + log
// INSERT 在 DB 端同一交易），mock 骨架共用：orders 只剩前置的狀態查詢，寫入
// 全看 rpc 的回傳；payment 表供取消守衛的 findPaidPayment（T127）。
// rpcCall 記錄參數供斷言。
const rpcCall = vi.fn();

type PaidResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};

// knob 互斥使用：rpcErrorMessage（RPC 回 {error}）優先於 updateMatches
// （CAS 是否搶到，預設 true=搶到）。
function makeServiceRole(opts: {
  initialStatus: OrderStatus;
  updateMatches?: boolean;
  rpcErrorMessage?: string;
  // 取消守衛的 findPaidPayment 依序回傳（第 1 次＝pre-guard、第 2 次＝post-cancel
  // 再查）。預設兩次都「查無 paid」。
  paidResults?: PaidResult[];
}) {
  const paidQueue = [...(opts.paidResults ?? [])];
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
      if (table === "payment") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve(paidQueue.shift() ?? { data: null, error: null }),
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
  sentryCaptureMessage.mockClear();
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
      ["completed", "refunded"], // T47：已完成訂單因瑕疵協議退款
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
    // T47 起 completed 不再是終止狀態（completed → refunded 合法）。
    const terminals: OrderStatus[] = ["cancelled", "refunded"];
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

describe("transitionOrder：取消守衛（有 paid payment 不得取消）", () => {
  it("pre-guard：訂單已有 paid payment → 丟 PaidOrderCancelBlockedError、不 UPDATE、不寫 log", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "pending_payment",
        updateMatches: true,
        // 第 1 次（pre-guard）就查到 paid。
        paidResults: [{ data: { id: "pay-1" }, error: null }],
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await expect(
      transitionOrder("order-1", "cancelled"),
    ).rejects.toBeInstanceOf(PaidOrderCancelBlockedError);
    // 守衛在 RPC 之前擋下：訂單沒被取消、log 沒寫（T110 後兩者同一交易）。
    expect(rpcCall).not.toHaveBeenCalled();
  });

  it("TOCTOU：pre-guard 沒查到、cancel 後才查到 paid → 仍取消＋寫 log，另發 P0 告警", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "pending_payment",
        updateMatches: true,
        // 第 1 次（pre-guard）查無、第 2 次（post-cancel 再查）才命中。
        paidResults: [
          { data: null, error: null },
          { data: { id: "pay-1" }, error: null },
        ],
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await transitionOrder("order-1", "cancelled");

    // 取消已完成（RPC 有呼叫；T110 後狀態＋log 同一交易）。
    expect(rpcCall).toHaveBeenCalledWith(
      expect.objectContaining({ p_to: "cancelled" }),
    );
    // 錢收在剛取消的訂單上 → P0 告警（走 §6.1 人工裁決）。
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "transitionOrder: money received on order cancelled during transition",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("Conv2：post-cancel 再查 {error} → 降級 warning、不影響已完成的取消", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "pending_payment",
        updateMatches: true,
        paidResults: [
          { data: null, error: null },
          { data: null, error: { message: "connection timeout" } },
        ],
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await transitionOrder("order-1", "cancelled");

    // 取消照常完成。
    expect(rpcCall).toHaveBeenCalledWith(
      expect.objectContaining({ p_to: "cancelled" }),
    );
    // 再查失敗只降級 warning，不升 P0、不 throw。
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "transitionOrder: post-cancel paid check failed",
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("非取消轉換（paid→in_production）不觸發取消守衛（不查 payment）", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "paid",
        updateMatches: true,
        // 故意不給 paidResults：若守衛誤觸發會 shift 到預設 null，但更重要的是
        // 這條轉換根本不該查 payment——用 log 有寫、無告警間接確認正常完成。
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await transitionOrder("order-1", "in_production");

    expect(rpcCall).toHaveBeenCalledWith(
      expect.objectContaining({ p_to: "in_production" }),
    );
    expect(sentryCaptureMessage).not.toHaveBeenCalled();
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
