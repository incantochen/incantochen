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

// transitionOrder／adminOverrideStatus 的 CAS 守衛測試共用同一套「orders +
// order_status_log」mock 骨架，只有 initialStatus／updateMatches 不同。
const logInsert = vi.fn().mockResolvedValue({ error: null });

function makeServiceRole(opts: {
  initialStatus: OrderStatus;
  updateMatches: boolean;
}) {
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
      if (table === "order_status_log") {
        return { insert: logInsert };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

beforeEach(() => {
  logInsert.mockClear();
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
