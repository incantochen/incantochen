/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const sentryCaptureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
}));

import { markPendingPaymentsFailed } from "../mark-pending-payments-failed";

let captured: { values: unknown; filters: Record<string, unknown> };
let updateError: { message: string } | null;

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table !== "payment") throw new Error(`unexpected table ${table}`);
      const filters: Record<string, unknown> = {};
      const chain: any = {
        update: (values: unknown) => {
          captured = { values, filters };
          return chain;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        },
        then: (resolve: (v: unknown) => void) => {
          resolve({ error: updateError });
        },
      };
      return chain;
    },
  };
}

beforeEach(() => {
  captured = { values: undefined, filters: {} };
  updateError = null;
  sentryCaptureMessage.mockClear();
});

describe("markPendingPaymentsFailed", () => {
  it("把該訂單所有 pending payment 標 failed（SET status=failed WHERE order_id AND status=pending）", async () => {
    await markPendingPaymentsFailed(makeServiceRole() as any, "order-1");

    expect(captured.values).toEqual({ status: "failed" });
    expect(captured.filters).toEqual({
      order_id: "order-1",
      status: "pending",
    });
    expect(sentryCaptureMessage).not.toHaveBeenCalled();
  });

  it("UPDATE 回 { error }（DB 暫時故障）→ 降級 warning、不 throw（不影響呼叫端主流程）", async () => {
    updateError = { message: "connection timeout" };

    await expect(
      markPendingPaymentsFailed(makeServiceRole() as any, "order-1"),
    ).resolves.toBeUndefined();

    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "payment: mark-pending-failed sweep failed",
      expect.objectContaining({ level: "warning" }),
    );
  });
});
