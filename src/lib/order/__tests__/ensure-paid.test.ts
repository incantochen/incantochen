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
  data: { id: string; cart_id: string | null; created_at: string } | null;
  error: any;
};

const ORDER_CREATED_AT = "2026-07-01T00:00:00.000Z";
const CART_UNCHANGED_SINCE = "2026-06-30T00:00:00.000Z"; // 早於訂單建立時間
const CART_TOUCHED_AFTER = "2026-07-02T00:00:00.000Z"; // 晚於訂單建立時間

function makeServiceRole(opts: {
  promote: PromoteResult;
  logError?: any;
  cartDeleteError?: any;
  cartUpdatedAt?: string | null; // null 代表 cart 已不存在
  currentOrderStatus?: string; // 給「!promoted」分支查詢現況用
}) {
  const cartDeleteCalls: string[] = [];
  const logInsert = vi.fn().mockResolvedValue({ error: opts.logError ?? null });
  const cartUpdatedAt = opts.cartUpdatedAt ?? CART_UNCHANGED_SINCE;

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
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: opts.currentOrderStatus
                    ? { status: opts.currentOrderStatus }
                    : null,
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
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data:
                    cartUpdatedAt === null
                      ? null
                      : { updated_at: cartUpdatedAt },
                  error: null,
                }),
            }),
          }),
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
  it("promoted.cart_id 非 null，cart 下單後沒被動過 → 刪除對應 cart", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: {
        data: { id: "order-1", cart_id: "cart-1", created_at: ORDER_CREATED_AT },
        error: null,
      },
      cartUpdatedAt: CART_UNCHANGED_SINCE,
    });

    await ensureOrderPaid(serviceRole, "order-1", "webhook");

    expect(cartDeleteCalls).toEqual(["cart-1"]);
  });

  it("cart 在下單後又被追加新品項（updated_at 晚於訂單建立時間）→ 保留 cart，不刪除", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: {
        data: { id: "order-1", cart_id: "cart-1", created_at: ORDER_CREATED_AT },
        error: null,
      },
      cartUpdatedAt: CART_TOUCHED_AFTER,
    });

    await ensureOrderPaid(serviceRole, "order-1", "webhook");

    expect(cartDeleteCalls).toEqual([]);
  });

  it("promoted.cart_id 為 null（訂單非源自現存 cart）→ 不呼叫 cart delete", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: {
        data: { id: "order-1", cart_id: null, created_at: ORDER_CREATED_AT },
        error: null,
      },
    });

    await ensureOrderPaid(serviceRole, "order-1", "webhook");

    expect(cartDeleteCalls).toEqual([]);
  });

  it("!promoted 但訂單現況已是 paid（正常冪等重入）→ 不碰 cart，不視為異常", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "paid",
    });

    await ensureOrderPaid(serviceRole, "order-1", "webhook");

    expect(cartDeleteCalls).toEqual([]);
  });

  it("!promoted 且訂單現況是 cancelled（cron 搶先取消、但錢已收到）→ 不 throw，仍正常結束", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "cancelled",
    });

    await expect(
      ensureOrderPaid(serviceRole, "order-1", "webhook"),
    ).resolves.toBeUndefined();
    expect(cartDeleteCalls).toEqual([]);
  });

  it("cart delete 回傳 error → 不 throw，函式正常結束（清車失敗不擋付款確認流程）", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: {
        data: { id: "order-1", cart_id: "cart-1", created_at: ORDER_CREATED_AT },
        error: null,
      },
      cartDeleteError: { message: "db down" },
    });

    await expect(
      ensureOrderPaid(serviceRole, "order-1", "webhook"),
    ).resolves.toBeUndefined();
    expect(cartDeleteCalls).toEqual(["cart-1"]);
  });
});
