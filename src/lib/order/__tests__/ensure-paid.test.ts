/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const sendOrderConfirmation = vi.fn().mockResolvedValue(undefined);
const sendNewOrderNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email/order-confirmation", () => ({
  sendOrderConfirmation: (...args: unknown[]) => sendOrderConfirmation(...args),
}));
vi.mock("@/lib/email/new-order-notification", () => ({
  sendNewOrderNotification: (...args: unknown[]) =>
    sendNewOrderNotification(...args),
}));
const sendOnce = vi.fn(
  async (_sr: unknown, p: { send: () => Promise<void> }) => {
    await p.send();
  },
);
vi.mock("@/lib/notification/send-once", () => ({
  sendOnce: (...args: unknown[]) =>
    sendOnce(...(args as [unknown, { send: () => Promise<void> }])),
}));

import { ensureOrderPaid } from "../ensure-paid";

type PromoteResult = {
  data: { id: string; cart_id: string | null } | null;
  error: any;
};

function makeServiceRole(opts: {
  promote: PromoteResult;
  logError?: any;
  cartDeleteError?: any;
}) {
  const cartDeleteCalls: string[] = [];
  const logInsert = vi.fn().mockResolvedValue({ error: opts.logError ?? null });

  const serviceRole: any = {
    from: (table: string) => {
      if (table === "orders") {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve(opts.promote),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "order_status_log") {
        return { insert: logInsert };
      }
      if (table === "cart") {
        return {
          delete: () => ({
            eq: (_col: string, cartId: string) => {
              cartDeleteCalls.push(cartId);
              return Promise.resolve({ error: opts.cartDeleteError ?? null });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { serviceRole, cartDeleteCalls, logInsert };
}

beforeEach(() => {
  sendOrderConfirmation.mockClear();
  sendNewOrderNotification.mockClear();
  sendOnce.mockClear();
});

describe("ensureOrderPaid：T75 付款成功清購物車", () => {
  it("promoted.cart_id 非 null → 刪除對應 cart", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: { data: { id: "order-1", cart_id: "cart-1" }, error: null },
    });

    await ensureOrderPaid(serviceRole, "order-1", "webhook");

    expect(cartDeleteCalls).toEqual(["cart-1"]);
  });

  it("promoted.cart_id 為 null（訂單非源自現存 cart）→ 不呼叫 cart delete", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: { data: { id: "order-1", cart_id: null }, error: null },
    });

    await ensureOrderPaid(serviceRole, "order-1", "webhook");

    expect(cartDeleteCalls).toEqual([]);
  });

  it("!promoted（沒搶到 CAS，例如已是 paid）→ 完全不碰 cart", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: { data: null, error: null },
    });

    await ensureOrderPaid(serviceRole, "order-1", "webhook");

    expect(cartDeleteCalls).toEqual([]);
  });

  it("cart delete 回傳 error → 不 throw，函式正常結束（清車失敗不擋付款確認流程）", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: { data: { id: "order-1", cart_id: "cart-1" }, error: null },
      cartDeleteError: { message: "db down" },
    });

    await expect(
      ensureOrderPaid(serviceRole, "order-1", "webhook"),
    ).resolves.toBeUndefined();
    expect(cartDeleteCalls).toEqual(["cart-1"]);
  });
});
