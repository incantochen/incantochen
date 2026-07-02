import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@/lib/order/order-status";
import {
  REQUEST_TYPE_LABELS,
  SUPPORT_STATUS_LABELS,
  canRequestSupport,
  type SupportRequestStatus,
  type SupportRequestType,
} from "./support-request";

describe("canRequestSupport", () => {
  const cases: [OrderStatus, boolean][] = [
    ["pending_payment", false],
    ["paid", true],
    ["in_production", true],
    ["shipped", true],
    ["completed", true],
    ["cancelled", false],
    ["refunded", false],
  ];

  it.each(cases)("%s → %s", (status, expected) => {
    expect(canRequestSupport(status)).toBe(expected);
  });
});

describe("REQUEST_TYPE_LABELS", () => {
  it("每個 SupportRequestType 都有對應 label", () => {
    const types: SupportRequestType[] = ["return_defect", "repair_maintenance"];
    for (const type of types) {
      expect(REQUEST_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});

describe("SUPPORT_STATUS_LABELS", () => {
  it("每個 SupportRequestStatus 都有對應 label", () => {
    const statuses: SupportRequestStatus[] = [
      "pending",
      "in_progress",
      "completed",
      "rejected",
    ];
    for (const status of statuses) {
      expect(SUPPORT_STATUS_LABELS[status]).toBeTruthy();
    }
  });
});
