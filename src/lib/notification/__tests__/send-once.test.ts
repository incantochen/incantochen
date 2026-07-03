import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type NotificationRow = { id: string; status: string };

const notifications = new Map<string, NotificationRow>();

function key(orderId: string, type: string) {
  return `${orderId}:${type}`;
}

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table !== "notification") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        insert: (values: {
          id: string;
          order_id: string;
          type: string;
          status: string;
        }) => {
          const k = key(values.order_id, values.type);
          if (notifications.has(k)) {
            return Promise.resolve({ error: { code: "23505" } });
          }
          notifications.set(k, { id: values.id, status: values.status });
          return Promise.resolve({ error: null });
        },
        select: () => ({
          eq: (_col1: string, orderId: string) => ({
            eq: (_col2: string, type: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: notifications.get(key(orderId, type)) ?? null,
                }),
            }),
          }),
        }),
        update: (values: { status: string; sent_at?: string }) => ({
          eq: (_col: string, id: string) => {
            for (const row of notifications.values()) {
              if (row.id === id) row.status = values.status;
            }
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  };
}

beforeEach(() => {
  notifications.clear();
});

import { sendOnce } from "../send-once";

describe("sendOnce", () => {
  it("首次寄送：insert pending → send 成功 → 更新為 sent", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOnce(makeServiceRole() as any, {
      orderId: "o1",
      type: "order_confirmation",
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(notifications.get("o1:order_confirmation")?.status).toBe("sent");
  });

  it("已成功寄過（status=sent）→ 撞 23505 → 不重寄", async () => {
    const sr = makeServiceRole();
    await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send: vi.fn().mockResolvedValue(undefined),
      },
    );

    const send2 = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOnce(sr as any, {
      orderId: "o1",
      type: "order_confirmation",
      send: send2,
    });

    expect(send2).not.toHaveBeenCalled();
  });

  it("寄送失敗 → status=failed；重送（撞 23505）會重試", async () => {
    const sr = makeServiceRole();
    const failing = vi.fn().mockRejectedValue(new Error("resend down"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOnce(sr as any, {
      orderId: "o1",
      type: "order_confirmation",
      send: failing,
    });

    expect(notifications.get("o1:order_confirmation")?.status).toBe("failed");

    const retrySend = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOnce(sr as any, {
      orderId: "o1",
      type: "order_confirmation",
      send: retrySend,
    });

    expect(retrySend).toHaveBeenCalledTimes(1);
    expect(notifications.get("o1:order_confirmation")?.status).toBe("sent");
  });

  it("不同 type 各自獨立去重", async () => {
    const sr = makeServiceRole();
    await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send: vi.fn().mockResolvedValue(undefined),
      },
    );

    const send2 = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOnce(sr as any, {
      orderId: "o1",
      type: "new_order_notification",
      send: send2,
    });

    expect(send2).toHaveBeenCalledTimes(1);
  });
});
