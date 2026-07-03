import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type NotificationRow = { id: string; status: string; createdAt: number };

const notifications = new Map<string, NotificationRow>();
let insertMode: "normal" | "throw" | "error" = "normal";
let updateByIdMode: "normal" | "throw" = "normal";
let reclaimMode: "normal" | "throw" = "normal";

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
          if (insertMode === "throw") {
            throw new Error("simulated insert failure");
          }
          const k = key(values.order_id, values.type);
          if (notifications.has(k)) {
            return Promise.resolve({ error: { code: "23505" } });
          }
          if (insertMode === "error") {
            return Promise.resolve({ error: { code: "OTHER" } });
          }
          notifications.set(k, {
            id: values.id,
            status: values.status,
            createdAt: Date.now(),
          });
          return Promise.resolve({ error: null });
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: (values: Record<string, unknown>): any => {
          const filters: Record<string, string> = {};
          let ltFilter: { col: string; val: string } | undefined;
          const chain = {
            eq: (col: string, val: string) => {
              filters[col] = val;
              return chain;
            },
            lt: (col: string, val: string) => {
              ltFilter = { col, val };
              return chain;
            },
            select: () => ({
              maybeSingle: () => {
                if (reclaimMode === "throw") {
                  throw new Error("simulated reclaim failure");
                }
                // 條件式 reclaim：
                // update(...).eq('order_id',x).eq('type',y).eq('status',s)[.lt('created_at',t)].select('id').maybeSingle()
                const row = notifications.get(
                  key(filters.order_id ?? "", filters.type ?? ""),
                );
                if (!row || row.status !== filters.status) {
                  return Promise.resolve({ data: null });
                }
                if (ltFilter?.col === "created_at") {
                  const threshold = new Date(ltFilter.val).getTime();
                  if (!(row.createdAt < threshold)) {
                    return Promise.resolve({ data: null });
                  }
                }
                Object.assign(row, values);
                return Promise.resolve({ data: { id: row.id } });
              },
            }),
            then: (resolve: (v: unknown) => void) => {
              // 非條件式 update-by-id：update(...).eq('id', id)
              if (updateByIdMode === "throw") {
                throw new Error("simulated update failure");
              }
              for (const row of notifications.values()) {
                if (row.id === filters.id) Object.assign(row, values);
              }
              resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

beforeEach(() => {
  notifications.clear();
  insertMode = "normal";
  updateByIdMode = "normal";
  reclaimMode = "normal";
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

  it("claim insert 拋例外 → best-effort 直接寄送，不因記錄不了而漏寄", async () => {
    insertMode = "throw";
    const send = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOnce(makeServiceRole() as any, {
      orderId: "o1",
      type: "order_confirmation",
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(notifications.has("o1:order_confirmation")).toBe(false);
  });

  it("claim insert 回傳非 23505 錯誤 → best-effort 直接寄送", async () => {
    insertMode = "error";
    const send = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOnce(makeServiceRole() as any, {
      orderId: "o1",
      type: "order_confirmation",
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(notifications.has("o1:order_confirmation")).toBe(false);
  });

  it("send 成功但標記 sent 失敗 → 不可回頭標成 failed（避免誤導成沒寄到）", async () => {
    updateByIdMode = "throw";
    const send = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOnce(makeServiceRole() as any, {
      orderId: "o1",
      type: "order_confirmation",
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(notifications.get("o1:order_confirmation")?.status).not.toBe(
      "failed",
    );
  });

  it("並發：atomic reclaim 防止兩個請求同時看到 failed 而重複寄信", async () => {
    const sr = makeServiceRole();
    notifications.set(key("o1", "order_confirmation"), {
      id: "n0",
      status: "failed",
      createdAt: Date.now(),
    });

    let resolveFirstSend: () => void = () => {};
    const firstSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstSend = resolve;
        }),
    );
    const secondSend = vi.fn().mockResolvedValue(undefined);

    const firstCall = sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr as any,
      { orderId: "o1", type: "order_confirmation", send: firstSend },
    );

    // 讓第一個請求先完成「原子 UPDATE ... WHERE status=failed」這一步
    // （status 已經被搶先改成 pending），但尚未完成 send()。
    for (let i = 0; i < 5; i++) await Promise.resolve();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOnce(sr as any, {
      orderId: "o1",
      type: "order_confirmation",
      send: secondSend,
    });

    // 第二個請求應該看到 status=pending（不是 failed），不會重寄。
    expect(secondSend).not.toHaveBeenCalled();

    resolveFirstSend();
    await firstCall;

    expect(firstSend).toHaveBeenCalledTimes(1);
    expect(notifications.get("o1:order_confirmation")?.status).toBe("sent");
  });

  it("reclaim UPDATE 本身拋例外 → sendOnce 整體不往外拋，只記 log（review round 2）", async () => {
    const sr = makeServiceRole();
    notifications.set(key("o1", "order_confirmation"), {
      id: "n0",
      status: "failed",
      createdAt: Date.now(),
    });
    reclaimMode = "throw";

    const send = vi.fn().mockResolvedValue(undefined);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendOnce(sr as any, {
        orderId: "o1",
        type: "order_confirmation",
        send,
      }),
    ).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
  });

  it("pending 卡太久（process 疑似被砍斷）→ 視為卡住，reclaim 後重試（review round 3）", async () => {
    const sr = makeServiceRole();
    notifications.set(key("o1", "order_confirmation"), {
      id: "n0",
      status: "pending",
      createdAt: Date.now() - 5 * 60 * 1000, // 5 分鐘前，早已超過 2 分鐘門檻
    });

    const send = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOnce(sr as any, {
      orderId: "o1",
      type: "order_confirmation",
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(notifications.get("o1:order_confirmation")?.status).toBe("sent");
  });

  it("pending 剛建立不久（可能真的還在處理中）→ 不會被誤撿去重寄", async () => {
    const sr = makeServiceRole();
    notifications.set(key("o1", "order_confirmation"), {
      id: "n0",
      status: "pending",
      createdAt: Date.now(), // 剛剛才建立
    });

    const send = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOnce(sr as any, {
      orderId: "o1",
      type: "order_confirmation",
      send,
    });

    expect(send).not.toHaveBeenCalled();
    expect(notifications.get("o1:order_confirmation")?.status).toBe("pending");
  });
});
