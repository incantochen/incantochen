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
        // 純讀查詢：select('status').eq('order_id',x).eq('type',y).maybeSingle()
        // 用來在「沒 reclaim 到」時確認目前是否已經 sent。
        select: () => {
          const filters: Record<string, string> = {};
          const chain = {
            eq: (col: string, val: string) => {
              filters[col] = val;
              return chain;
            },
            maybeSingle: () => {
              const row = notifications.get(
                key(filters.order_id ?? "", filters.type ?? ""),
              );
              return Promise.resolve({
                data: row ? { status: row.status } : null,
              });
            },
          };
          return chain;
        },
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
                // 真實 SET 用的欄位是 snake_case created_at；mock 內部用
                // camelCase createdAt 做門檻比較，這裡同步更新，才能驗證
                // 「reclaim 會一併推進 created_at，讓第二個並發請求重新檢查
                // WHERE 條件時落空」這個修法是否生效。
                if (typeof values.created_at === "string") {
                  row.createdAt = new Date(values.created_at).getTime();
                }
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
  it("首次寄送：insert pending → send 成功 → 更新為 sent → 回傳 true", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeServiceRole() as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send,
      },
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(notifications.get("o1:order_confirmation")?.status).toBe("sent");
    expect(result).toBe(true);
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
    const result2 = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send: send2,
      },
    );

    expect(send2).not.toHaveBeenCalled();
    expect(result2).toBe(true);
  });

  it("寄送失敗 → status=failed、回傳 false；重送（撞 23505）會重試並回傳 true", async () => {
    const sr = makeServiceRole();
    const failing = vi.fn().mockRejectedValue(new Error("resend down"));
    const result1 = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send: failing,
      },
    );

    expect(notifications.get("o1:order_confirmation")?.status).toBe("failed");
    expect(result1).toBe(false);

    const retrySend = vi.fn().mockResolvedValue(undefined);
    const result2 = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send: retrySend,
      },
    );

    expect(retrySend).toHaveBeenCalledTimes(1);
    expect(notifications.get("o1:order_confirmation")?.status).toBe("sent");
    expect(result2).toBe(true);
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

  it("claim insert 拋例外 → best-effort 直接寄送、成功回傳 true，不因記錄不了而漏寄", async () => {
    insertMode = "throw";
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeServiceRole() as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send,
      },
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(notifications.has("o1:order_confirmation")).toBe(false);
    expect(result).toBe(true);
  });

  it("claim insert 回傳非 23505 錯誤 → best-effort 直接寄送、成功回傳 true", async () => {
    insertMode = "error";
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeServiceRole() as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send,
      },
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(notifications.has("o1:order_confirmation")).toBe(false);
    expect(result).toBe(true);
  });

  it("claim insert 拋例外 + best-effort send 也失敗 → 回傳 false", async () => {
    insertMode = "throw";
    const send = vi.fn().mockRejectedValue(new Error("resend down"));
    const result = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeServiceRole() as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send,
      },
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it("send 成功但標記 sent 失敗 → 不可回頭標成 failed（避免誤導成沒寄到）、仍回傳 true", async () => {
    updateByIdMode = "throw";
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeServiceRole() as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send,
      },
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(notifications.get("o1:order_confirmation")?.status).not.toBe(
      "failed",
    );
    expect(result).toBe(true);
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

    const secondResult = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send: secondSend,
      },
    );

    // 第二個請求應該看到 status=pending（不是 failed），不會重寄。
    expect(secondSend).not.toHaveBeenCalled();
    // 此時第一個請求尚未完成 send()，無法確認是否送達，誠實回 false
    // （而非樂觀假設對方一定會成功）——這個回傳值會被 webhook 用來決定
    // 是否讓 ECPay 重送，樂觀回 true 會讓真正的寄信失敗永遠無法被重試。
    expect(secondResult).toBe(false);

    resolveFirstSend();
    await firstCall;

    expect(firstSend).toHaveBeenCalledTimes(1);
    expect(notifications.get("o1:order_confirmation")?.status).toBe("sent");
  });

  it("reclaim UPDATE 本身拋例外 → sendOnce 整體不往外拋、回傳 false，只記 log（review round 2）", async () => {
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
    ).resolves.toBe(false);

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

  it("並發：兩個請求同時撿同一筆卡住的 pending → 只有一個重寄（ultrareview 第二輪 merged_bug_001 gap 1）", async () => {
    const sr = makeServiceRole();
    notifications.set(key("o1", "order_confirmation"), {
      id: "n0",
      status: "pending",
      createdAt: Date.now() - 5 * 60 * 1000, // 5 分鐘前，早已超過 2 分鐘門檻
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

    // 讓第一個請求先完成 reclaim（此時已經把 created_at 推進到現在，
    // 不再早於 stale 門檻），但尚未完成 send()。
    for (let i = 0; i < 5; i++) await Promise.resolve();

    const secondResult = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send: secondSend,
      },
    );

    // 第二個請求的 stale-pending 條件應該因為 created_at 已被第一個請求
    // 推進而不再符合，不會重寄。若沒有這次修法（reclaim 沒有一併更新
    // created_at），第二個請求會用同一個舊 createdAt 再次判定為卡住而重寄。
    expect(secondSend).not.toHaveBeenCalled();
    // 第一個請求尚未完成 send()，無法確認是否送達，誠實回 false。
    expect(secondResult).toBe(false);

    resolveFirstSend();
    await firstCall;

    expect(firstSend).toHaveBeenCalledTimes(1);
    expect(notifications.get("o1:order_confirmation")?.status).toBe("sent");
  });

  it("pending 剛建立不久（可能真的還在處理中）→ 不會被誤撿去重寄、回傳 false（無法確認送達）", async () => {
    const sr = makeServiceRole();
    notifications.set(key("o1", "order_confirmation"), {
      id: "n0",
      status: "pending",
      createdAt: Date.now(), // 剛剛才建立
    });

    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send,
      },
    );

    expect(send).not.toHaveBeenCalled();
    expect(notifications.get("o1:order_confirmation")?.status).toBe("pending");
    expect(result).toBe(false);
  });

  it("沒 reclaim 到、但目前狀態其實已經是 sent（另一並發請求已完成送達）→ 回傳 true", async () => {
    const sr = makeServiceRole();
    notifications.set(key("o1", "order_confirmation"), {
      id: "n0",
      status: "sent",
      createdAt: Date.now(),
    });

    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr as any,
      {
        orderId: "o1",
        type: "order_confirmation",
        send,
      },
    );

    expect(send).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
