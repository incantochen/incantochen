/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Sentry mock：驗證「該告警的路徑有告警、正常冪等重入不告警」——T107 後
// reconcile 隔日重試會撞上已被推進的訂單，誤報與漏報都要鎖住。
const { sentryCaptureMessage, sentryCaptureException } = vi.hoisted(() => ({
  sentryCaptureMessage: vi.fn(),
  sentryCaptureException: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
  captureException: (...args: unknown[]) => sentryCaptureException(...args),
}));

const sendOrderConfirmation = vi.fn().mockResolvedValue(undefined);
const sendNewOrderNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email/order-confirmation", () => ({
  sendOrderConfirmation: (...args: unknown[]) => sendOrderConfirmation(...args),
}));
vi.mock("@/lib/email/new-order-notification", () => ({
  sendNewOrderNotification: (...args: unknown[]) =>
    sendNewOrderNotification(...args),
}));
// sendOnce 回傳布林（T88）：預設兩種 type 皆視為投遞成功，測試可透過
// sendOnceResult 針對特定 type 覆寫成 false，模擬「其中一封信真的沒寄出」。
let sendOnceResult: Record<string, boolean> = {};
const sendOnce = vi.fn(
  async (_sr: unknown, p: { type: string; send: () => Promise<void> }) => {
    await p.send();
    return sendOnceResult[p.type] ?? true;
  },
);
vi.mock("@/lib/notification/send-once", () => ({
  sendOnce: (...args: unknown[]) =>
    sendOnce(
      ...(args as [unknown, { type: string; send: () => Promise<void> }]),
    ),
}));

import { ensureOrderPaid, ensureNotificationSent } from "../ensure-paid";

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
  orderItems?: { product_id: string; config_snapshot: unknown }[];
  cartItems?: { id: string; product_id: string; config_snapshot: unknown }[];
}) {
  const cartDeleteCalls: string[] = [];
  const cartItemDeleteIds: string[][] = [];
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
      if (table === "order_item") {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: opts.orderItems ?? [], error: null }),
        };
        return chain;
      }
      if (table === "cart_item") {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          delete: () => chain,
          in: (_col: string, ids: string[]) => {
            cartItemDeleteIds.push(ids);
            return chain;
          },
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: opts.cartItems ?? [], error: null }),
        };
        return chain;
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

  return { serviceRole, cartDeleteCalls, cartItemDeleteIds, logInsert };
}

beforeEach(() => {
  sendOrderConfirmation.mockClear();
  sendNewOrderNotification.mockClear();
  sendOnce.mockClear();
  sendOnceResult = {};
  sentryCaptureMessage.mockClear();
  sentryCaptureException.mockClear();
});

describe("ensureOrderPaid：T75 付款成功清購物車", () => {
  it("promoted.cart_id 非 null，cart 下單後沒被動過 → 刪除對應 cart", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: {
        data: {
          id: "order-1",
          cart_id: "cart-1",
          created_at: ORDER_CREATED_AT,
        },
        error: null,
      },
      cartUpdatedAt: CART_UNCHANGED_SINCE,
    });

    // 真正搶到推進的 happy path 回傳 "promoted"（reconcile 據此計數）。
    await expect(
      ensureOrderPaid(serviceRole, "order-1", "webhook"),
    ).resolves.toBe("promoted");

    expect(cartDeleteCalls).toEqual(["cart-1"]);
  });

  it("cart 在下單後又被追加新品項 → 不整張刪除，只移除訂單裡買過的品項（product_id+config 相符），新品項保留", async () => {
    const boughtConfig = { metal: "gold" };
    const { serviceRole, cartDeleteCalls, cartItemDeleteIds } = makeServiceRole(
      {
        promote: {
          data: {
            id: "order-1",
            cart_id: "cart-1",
            created_at: ORDER_CREATED_AT,
          },
          error: null,
        },
        cartUpdatedAt: CART_TOUCHED_AFTER,
        orderItems: [{ product_id: "prod-a", config_snapshot: boughtConfig }],
        cartItems: [
          {
            id: "ci-bought",
            product_id: "prod-a",
            config_snapshot: boughtConfig,
          },
          { id: "ci-new", product_id: "prod-b", config_snapshot: {} },
          // 同商品但不同配置：不算買過，必須保留
          {
            id: "ci-variant",
            product_id: "prod-a",
            config_snapshot: { metal: "silver" },
          },
        ],
      },
    );

    await ensureOrderPaid(serviceRole, "order-1", "webhook");

    expect(cartDeleteCalls).toEqual([]); // 整張 cart 不刪
    expect(cartItemDeleteIds).toEqual([["ci-bought"]]); // 只刪買過的那筆
  });

  it("cart 被動過且沒有任何品項與訂單相符 → 不刪任何東西", async () => {
    const { serviceRole, cartDeleteCalls, cartItemDeleteIds } = makeServiceRole(
      {
        promote: {
          data: {
            id: "order-1",
            cart_id: "cart-1",
            created_at: ORDER_CREATED_AT,
          },
          error: null,
        },
        cartUpdatedAt: CART_TOUCHED_AFTER,
        orderItems: [{ product_id: "prod-a", config_snapshot: {} }],
        cartItems: [
          { id: "ci-new", product_id: "prod-b", config_snapshot: {} },
        ],
      },
    );

    await ensureOrderPaid(serviceRole, "order-1", "webhook");

    expect(cartDeleteCalls).toEqual([]);
    expect(cartItemDeleteIds).toEqual([]);
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

  it("!promoted 但訂單現況已是 paid（正常冪等重入）→ 不碰 cart，不視為異常、不告警", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "paid",
    });

    await expect(
      ensureOrderPaid(serviceRole, "order-1", "webhook"),
    ).resolves.toBe("already-settled");

    expect(cartDeleteCalls).toEqual([]);
    // 良性路徑兩支 Sentry API 都不得被呼叫——只鎖 captureMessage 的話，實作
    // 若改用 captureException 告警會靜默漏測。
    expect(sentryCaptureMessage).not.toHaveBeenCalled();
    expect(sentryCaptureException).not.toHaveBeenCalled();
  });

  it("!promoted 且訂單已推進到 in_production（PAID_LINEAGE）→ 視為正常冪等重入，不告警（T107）", async () => {
    // T107 後可達的劇本：reconcile day1 推進訂單成功但 payment CAS 遇暫時錯誤
    // → 當天管理員把訂單推進到製作 → day2 重試時 CAS miss、重查得 in_production。
    // 這是付款成立後的正常演進，只認 exactly 'paid' 會誤發「付款卡住」P0 告警。
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "in_production",
    });

    await expect(
      ensureOrderPaid(serviceRole, "order-1", "reconcile"),
    ).resolves.toBe("already-settled");
    expect(cartDeleteCalls).toEqual([]);
    // 同上一測試：良性路徑兩支 Sentry API 都不得被呼叫。
    expect(sentryCaptureMessage).not.toHaveBeenCalled();
    expect(sentryCaptureException).not.toHaveBeenCalled();
  });

  it("!promoted 且訂單現況是 cancelled（cron 搶先取消、但錢已收到）→ 不 throw、發告警，仍正常結束", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "cancelled",
    });

    // 回傳 "anomalous"：reconcile 據此把「錢收在已關閉訂單上」與健康搶救分流。
    await expect(
      ensureOrderPaid(serviceRole, "order-1", "webhook"),
    ).resolves.toBe("anomalous");
    expect(cartDeleteCalls).toEqual([]);
    // 「錢收到了、訂單卡 cancelled」不可靜默放過。
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1);
  });

  it("cart delete 回傳 error → 不 throw，函式正常結束（清車失敗不擋付款確認流程）", async () => {
    const { serviceRole, cartDeleteCalls } = makeServiceRole({
      promote: {
        data: {
          id: "order-1",
          cart_id: "cart-1",
          created_at: ORDER_CREATED_AT,
        },
        error: null,
      },
      cartDeleteError: { message: "db down" },
    });

    // 清車失敗只告警不拋錯，仍走完 promoted 路徑回 "promoted"。
    await expect(
      ensureOrderPaid(serviceRole, "order-1", "webhook"),
    ).resolves.toBe("promoted");
    expect(cartDeleteCalls).toEqual(["cart-1"]);
  });
});

// T88：sendOnce 從「絕不往外拋例外」改成「回傳布林」後，notifyOrderPaid／
// ensureNotificationSent 需正確聚合兩封信各自的投遞結果，讓 webhook 能據此
// 判斷是否要對 ECPay 回錯誤觸發重送。
describe("ensureNotificationSent / notifyOrderPaid：聚合投遞結果（T88）", () => {
  it("訂單 pending_payment（付款未成立）→ 不寄信，直接回傳 true", async () => {
    const { serviceRole } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "pending_payment",
    });

    const result = await ensureNotificationSent(serviceRole, "order-1");

    expect(result).toBe(true);
    expect(sendOnce).not.toHaveBeenCalled();
  });

  it("訂單已推進到 in_production（PAID_LINEAGE）→ 仍補寄，不因狀態推進切斷失敗信件的重試（T88 review）", async () => {
    // 情境：paid 時信寄失敗、webhook 回 ERR 排定重送；管理員在下一次重送
    // 抵達前把訂單推進到製作中。舊版只認 status==='paid' 會在這裡回 true、
    // ECPay 停止重送，失敗的信永遠沒人補寄。
    const { serviceRole } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "in_production",
    });

    const result = await ensureNotificationSent(serviceRole, "order-1");

    expect(result).toBe(true);
    expect(sendOnce).toHaveBeenCalledTimes(2);
  });

  it("訂單 shipped（PAID_LINEAGE）→ 仍補寄", async () => {
    const { serviceRole } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "shipped",
    });

    await ensureNotificationSent(serviceRole, "order-1");

    expect(sendOnce).toHaveBeenCalledTimes(2);
  });

  it("訂單 cancelled → 不寄信（避免對已取消訂單誤發確認信）、回傳 true", async () => {
    const { serviceRole } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "cancelled",
    });

    const result = await ensureNotificationSent(serviceRole, "order-1");

    expect(result).toBe(true);
    expect(sendOnce).not.toHaveBeenCalled();
  });

  it("訂單 refunded → 不寄信、回傳 true", async () => {
    const { serviceRole } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "refunded",
    });

    const result = await ensureNotificationSent(serviceRole, "order-1");

    expect(result).toBe(true);
    expect(sendOnce).not.toHaveBeenCalled();
  });

  it("查無此單 → 不寄信、回傳 true", async () => {
    const { serviceRole } = makeServiceRole({
      promote: { data: null, error: null },
      // currentOrderStatus 不給 → maybeSingle 回 data: null
    });

    const result = await ensureNotificationSent(serviceRole, "order-1");

    expect(result).toBe(true);
    expect(sendOnce).not.toHaveBeenCalled();
  });

  it("訂單 paid、兩封皆投遞成功 → 回傳 true", async () => {
    const { serviceRole } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "paid",
    });

    const result = await ensureNotificationSent(serviceRole, "order-1");

    expect(result).toBe(true);
    expect(sendOnce).toHaveBeenCalledTimes(2);
  });

  it("訂單 paid、其中一封（order_confirmation）投遞失敗 → 回傳 false", async () => {
    sendOnceResult = { order_confirmation: false };
    const { serviceRole } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "paid",
    });

    const result = await ensureNotificationSent(serviceRole, "order-1");

    expect(result).toBe(false);
  });

  it("訂單 paid、其中一封（new_order_notification）投遞失敗 → 回傳 false", async () => {
    sendOnceResult = { new_order_notification: false };
    const { serviceRole } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "paid",
    });

    const result = await ensureNotificationSent(serviceRole, "order-1");

    expect(result).toBe(false);
  });

  it("訂單 paid、兩封皆投遞失敗 → 回傳 false", async () => {
    sendOnceResult = {
      order_confirmation: false,
      new_order_notification: false,
    };
    const { serviceRole } = makeServiceRole({
      promote: { data: null, error: null },
      currentOrderStatus: "paid",
    });

    const result = await ensureNotificationSent(serviceRole, "order-1");

    expect(result).toBe(false);
  });
});
