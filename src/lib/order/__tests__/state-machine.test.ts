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

// transitionOrder／adminOverrideStatus 的 CAS 守衛測試共用同一套「orders +
// order_status_log + payment」mock 骨架，只有 initialStatus／updateMatches 與
// 取消守衛的 payment 查詢結果（findPaidPayment）不同。
const logInsert = vi.fn().mockResolvedValue({ error: null });

type PaidResult = { data: { id: string } | null; error: { message: string } | null };

function makeServiceRole(opts: {
  initialStatus: OrderStatus;
  updateMatches: boolean;
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
          single: () =>
            Promise.resolve({
              data: { status: opts.initialStatus },
              error: null,
            }),
          update: () => chain,
          maybeSingle: () =>
            Promise.resolve(
              opts.updateMatches
                ? { data: { id: "order-1" }, error: null }
                : { data: null, error: null },
            ),
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
      if (table === "order_status_log") {
        return { insert: logInsert };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

beforeEach(() => {
  logInsert.mockClear();
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
  it("併發：cron 判定 pending_payment 期間 webhook 搶先轉 paid → CAS 沒搶到，丟出 OrderTransitionRaceError、不寫 log", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "pending_payment",
        updateMatches: false,
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await expect(
      transitionOrder("order-1", "cancelled"),
    ).rejects.toBeInstanceOf(OrderTransitionRaceError);
    expect(logInsert).not.toHaveBeenCalled();
  });

  it("正常轉換：CAS 搶到 → 寫入 order_status_log，from/to 正確", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      makeServiceRole({
        initialStatus: "pending_payment",
        updateMatches: true,
      }) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    await transitionOrder("order-1", "cancelled", {
      note: "逾期未付款自動取消",
    });

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: "order-1",
        from_status: "pending_payment",
        to_status: "cancelled",
        note: "逾期未付款自動取消",
        is_override: false,
      }),
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
    // 守衛在 UPDATE 之前擋下：訂單沒被取消、log 沒寫。
    expect(logInsert).not.toHaveBeenCalled();
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

    // 取消已完成（log 有寫）。
    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({ to_status: "cancelled" }),
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
    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({ to_status: "cancelled" }),
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

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({ to_status: "in_production" }),
    );
    expect(sentryCaptureMessage).not.toHaveBeenCalled();
  });
});

describe("adminOverrideStatus：CAS 守衛（T92／F-007）", () => {
  it("to === from：拒絕、完全不碰 UPDATE，不寫 log（CAS 守衛在此 edge case 對並發無效，改用前置擋下）", async () => {
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
    expect(logInsert).not.toHaveBeenCalled();
  });

  it("併發：兩位管理者近乎同時對同一單送出互斥的 override 目標 → 沒搶到 CAS 的丟出 OrderTransitionRaceError、不寫 log", async () => {
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
    expect(logInsert).not.toHaveBeenCalled();
  });

  it("正常 override：CAS 搶到 → 寫入 order_status_log，is_override 為 true", async () => {
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

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: "order-1",
        from_status: "paid",
        to_status: "refunded",
        note: "客訴協議退款",
        actor_id: "admin-1",
        is_override: true,
      }),
    );
  });
});
