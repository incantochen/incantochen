import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let insertMode: "success" | "error" = "success";
let lastInsertPayload: unknown = null;

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== "pii_access_log") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        insert: (values: unknown) => {
          lastInsertPayload = values;
          if (insertMode === "error") {
            return Promise.resolve({
              error: { message: "simulated db error" },
            });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  })),
}));

import { logPiiAccess } from "./audit";

beforeEach(() => {
  insertMode = "success";
  lastInsertPayload = null;
});

describe("logPiiAccess", () => {
  it("insert 成功時以正確欄位對映寫入 pii_access_log，且不拋例外", async () => {
    await expect(
      logPiiAccess({
        actorId: "admin-1",
        actorEmail: "admin@incantochen.com",
        orderId: "order-1",
        fields: ["recipient_name", "recipient_phone"],
      }),
    ).resolves.toBeUndefined();

    expect(lastInsertPayload).toEqual({
      actor_id: "admin-1",
      actor_email: "admin@incantochen.com",
      order_id: "order-1",
      fields: ["recipient_name", "recipient_phone"],
    });
  });

  it("insert 回傳 error 時拋出例外（呼叫端 await 才能 fail closed）", async () => {
    insertMode = "error";

    await expect(
      logPiiAccess({
        actorId: "admin-1",
        actorEmail: "admin@incantochen.com",
        orderId: "order-1",
        fields: ["recipient_name"],
      }),
    ).rejects.toThrow("PII 稽核 log 寫入失敗");
  });
});
