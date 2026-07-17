/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// next/server 的 after() 需要 Next request scope，vitest 直呼 handler 沒有——
// 測試中改為同步立即執行回呼（生產行為是「回應送出後執行」，對測試斷言而言
// 等價：回呼跑完才驗證副作用）
vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>();
  return {
    ...original,
    after: (cb: () => unknown) => {
      void Promise.resolve(cb());
    },
  };
});

// serverEnv：測試用固定金鑰（值任意，簽章計算兩端一致即可）
vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    ECPAY_MERCHANT_ID: "3002607",
    ECPAY_HASH_KEY: "test-hash-key",
    ECPAY_HASH_IV: "test-hash-iv",
    ECPAY_PAYMENT_URL: "https://payment-stage.example/aio",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    UPSTASH_REDIS_REST_URL: "http://localhost",
    UPSTASH_REDIS_REST_TOKEN: "test",
    RESEND_API_KEY: "test",
    ADMIN_EMAIL: "admin@example.com",
  },
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
// T42：webhook 成功路徑會呼叫 ensureInvoiceIssued → issueInvoiceForOrder，
// 這份測試專注驗證付款推進與通知邏輯，發票開立是獨立關注點（有自己的測試
// 檔 src/lib/order/__tests__/issue-invoice.test.ts）——mock 掉避免對
// 未設定的 ECPAY_INVOICE_URL 發出真實 fetch
vi.mock("@/lib/order/issue-invoice", () => ({
  issueInvoiceForOrder: vi
    .fn()
    .mockResolvedValue({ ok: true, invoiceNo: "TEST", alreadyIssued: false }),
}));

// sendOnce：T69 的去重/重試邏輯已在 send-once.test.ts 獨立覆蓋，
// 這裡當依賴邊界整個 mock 掉，pass-through 呼叫 send() 即可，
// 讓既有的 sendOrderConfirmation/sendNewOrderNotification 斷言不用改。
// 回傳布林（T88）：預設投遞成功；測試可透過 sendOnceResult 針對特定 type
// 覆寫成 false，模擬「其中一封信真的沒寄出」以驗證 webhook 回 0|... 觸發重送。
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

// service role mock：以「呼叫記錄器」記下所有 update/insert，供斷言副作用。
// orders 表的 status 用單一事實來源 db.orderStatus 追蹤，並在模擬的
// transition_order_status RPC（T110）CAS 命中時真的「改掉」，讓後續
// ensureNotificationSent 的查詢讀得到最新狀態。
type DbState = {
  payment: {
    id: string;
    status: string;
    order_id: string;
    amount: number;
  } | null;
  paidPayment: { id: string } | null;
  orderStatus: string | null;
  order: { id: string; total_amount: number } | null;
  // K14：payment/orders 的 lookup 查詢回 { error }（暫時性 DB 故障，不 throw）。
  paymentSelectError: boolean;
  throwOnPaymentQuery: boolean;
  orderRaceLost: boolean;
  ordersUpdateError: boolean;
  ordersSelectError: boolean;
  paymentUpdateError: boolean;
  // 第一段 CAS（WHERE status='pending'）是否更新到列；false 模擬 T74 競態
  // （付款頁在 webhook 抵達前把這筆標成 failed）。
  paymentUpdateMatches: boolean;
  // 救援 CAS（WHERE status='failed'）是否更新到列。
  paymentRescueMatches: boolean;
};
const db: DbState = {
  payment: null,
  paidPayment: null,
  orderStatus: null,
  order: null,
  paymentSelectError: false,
  throwOnPaymentQuery: false,
  orderRaceLost: false,
  ordersUpdateError: false,
  ordersSelectError: false,
  paymentUpdateError: false,
  paymentUpdateMatches: true,
  paymentRescueMatches: false,
};
const recorded: { table: string; op: string; values?: unknown }[] = [];

function makeServiceRole() {
  return {
    from: (table: string) => makeChain(table),
    // T110：ensureOrderPaid 的 CAS 推進＋order_status_log 寫入改走
    // transition_order_status RPC（DB 端單一交易）。mock 沿用 db.* 旗標模擬
    // 原條件式 UPDATE 的三種結果（error／race lost／搶到並翻狀態），並以與
    // 舊實作相同的 table/op 記進 recorded——既有 updatesTo("orders")／
    // insertsTo("order_status_log") 斷言因此零改動。
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name !== "transition_order_status") {
        throw new Error(`unexpected rpc ${name}`);
      }
      recorded.push({
        table: "orders",
        op: "update",
        values: { status: args.p_to },
      });
      const chain = {
        // 實作鏈 .select("id, cart_id, created_at").maybeSingle()。
        select: () => chain,
        maybeSingle: () => {
          // ordersUpdateError 模擬 Supabase 回傳 { error }（暫時性 DB 故障或
          // RPC 內 log 寫入失敗 rollback，不會 throw）——呼叫端必須自己檢查
          // 並轉成 throw。
          if (db.ordersUpdateError) {
            return Promise.resolve({
              data: null,
              error: { message: "simulated update error" },
            });
          }
          // orderRaceLost 模擬「RPC 送出前，狀態已被別的請求搶先改掉」
          // → CAS 沒搶到，RPC 回空集合、交易內不寫 log。
          if (db.orderRaceLost) {
            return Promise.resolve({ data: null, error: null });
          }
          if (db.orderStatus === args.p_from) {
            db.orderStatus = args.p_to as string; // 模擬 RPC 真的把狀態改掉
            recorded.push({
              table: "order_status_log",
              op: "insert",
              values: {
                order_id: args.p_order_id,
                from_status: args.p_from,
                to_status: args.p_to,
                note: args.p_note ?? null,
                actor_id: args.p_actor_id ?? null,
                is_override: args.p_is_override,
              },
            });
            // 與實際 RPC 契約同形（.select 投影後三欄位）：cart_id null →
            // 不觸發 T75 清車分支（本套件不驗清車，ensure-paid.test.ts 涵蓋）。
            return Promise.resolve({
              data: {
                id: "promoted",
                cart_id: null,
                created_at: "2026-07-01T00:00:00.000Z",
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
}

function makeChain(table: string) {
  const chain: any = {
    _op: "select",
    _lastEq: undefined as { col: string; val: unknown } | undefined,
    select: () => chain,
    update: (values: unknown) => {
      chain._op = "update";
      recorded.push({ table, op: "update", values });
      return chain;
    },
    insert: (values: unknown) => {
      recorded.push({ table, op: "insert", values });
      return Promise.resolve({ error: null });
    },
    eq: (col: string, val: unknown) => {
      chain._lastEq = { col, val };
      return chain;
    },
    maybeSingle: () => {
      if (table === "payment") {
        if (db.throwOnPaymentQuery) {
          throw new Error("simulated DB failure");
        }
        if (chain._op === "update") {
          // 條件式 UPDATE 現在鏈 .select().maybeSingle() 檢查更新到幾列；
          // 靠 WHERE 的 status eq 值區分第一段 CAS（pending）與救援（failed）。
          if (
            chain._lastEq?.col === "status" &&
            chain._lastEq?.val === "failed"
          ) {
            return Promise.resolve({
              data: db.paymentRescueMatches ? { id: "p1" } : null,
              error: null,
            });
          }
          if (db.paymentUpdateError) {
            return Promise.resolve({
              data: null,
              error: { message: "simulated payment update error" },
            });
          }
          return Promise.resolve({
            data: db.paymentUpdateMatches ? { id: "p1" } : null,
            error: null,
          });
        }
        // fallback 分支的 paidPayment 冪等查詢：.eq("order_id",x).eq("status","paid")，
        // 跟外層用 merchant_trade_no 查 payment 是同一張表、不同查詢，靠最後一次
        // eq 的欄位/值分辨。
        if (chain._lastEq?.col === "status" && chain._lastEq?.val === "paid") {
          return Promise.resolve({ data: db.paidPayment, error: null });
        }
        // 主 lookup（merchant_trade_no 查 payment）：K14 可注入 { error }。
        if (db.paymentSelectError) {
          return Promise.resolve({
            data: null,
            error: { message: "simulated payment lookup error" },
          });
        }
        return Promise.resolve({ data: db.payment, error: null });
      }
      if (table === "orders") {
        // select 查詢：fallback 分支的訂單查找 / ensureNotificationSent 的狀態確認
        // （T110 後 orders 的 UPDATE 已移進 transition_order_status RPC，
        //  makeChain 只剩查詢路徑）。
        // ordersSelectError 模擬同上，用於 ensureNotificationSent 的錯誤處理測試。
        if (db.ordersSelectError) {
          return Promise.resolve({
            data: null,
            error: { message: "simulated select error" },
          });
        }
        if (db.orderStatus === null)
          return Promise.resolve({ data: null, error: null });
        return Promise.resolve({
          data: {
            id: db.order?.id ?? "o1",
            status: db.orderStatus,
            total_amount: db.order?.total_amount ?? 0,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null });
    },
    then: (resolve: (v: unknown) => void) => {
      // bug_001：正常路徑的 payment UPDATE（非 select/maybeSingle，走 then）
      // 也要能模擬 { error }，驗證它跟 ensureOrderPaid 一樣有檢查。
      if (
        table === "payment" &&
        chain._op === "update" &&
        db.paymentUpdateError
      ) {
        resolve({ error: { message: "simulated payment update error" } });
        return;
      }
      resolve({ error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => makeServiceRole(),
}));

import { POST } from "../route";
import { generateCheckMacValue } from "@/lib/ecpay/check-mac-value";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HASH_KEY = "test-hash-key";
const HASH_IV = "test-hash-iv";

function buildRequest(
  params: Record<string, string>,
  opts: { sign?: boolean } = { sign: true },
): Request {
  const body = { ...params };
  if (opts.sign !== false) {
    body.CheckMacValue = generateCheckMacValue(body, HASH_KEY, HASH_IV);
  } else {
    body.CheckMacValue =
      "0000000000000000000000000000000000000000000000000000000000000000";
  }
  const form = new URLSearchParams(body);
  return new Request("http://localhost/api/ecpay/notify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

const BASE_PARAMS = {
  MerchantID: "3002607",
  MerchantTradeNo: "INC20260702ABC123XY",
  TradeNo: "2607021234567890",
  TradeAmt: "25000",
  RtnCode: "1",
  RtnMsg: "交易成功",
};

function updatesTo(table: string) {
  return recorded.filter((r) => r.table === table && r.op === "update");
}
function insertsTo(table: string) {
  return recorded.filter((r) => r.table === table && r.op === "insert");
}

beforeEach(() => {
  recorded.length = 0;
  db.payment = null;
  db.paidPayment = null;
  db.orderStatus = null;
  db.order = null;
  db.paymentSelectError = false;
  db.throwOnPaymentQuery = false;
  db.orderRaceLost = false;
  db.ordersUpdateError = false;
  db.ordersSelectError = false;
  db.paymentUpdateError = false;
  db.paymentUpdateMatches = true;
  db.paymentRescueMatches = false;
  sendOrderConfirmation.mockClear();
  sendNewOrderNotification.mockClear();
  sendOnce.mockClear();
  sendOnceResult = {};
});

// ---------------------------------------------------------------------------
// 驗章（安全關卡）
// ---------------------------------------------------------------------------

describe("CheckMacValue 驗章", () => {
  it("簽章錯誤 → 回 0|CheckMacValue Error、不觸碰 DB、不寄信", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    const res = await POST(buildRequest(BASE_PARAMS, { sign: false }));
    expect(await res.text()).toBe("0|CheckMacValue Error");
    expect(recorded).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it("缺 MerchantTradeNo → 回 0|MerchantTradeNo missing", async () => {
    const rest = { ...BASE_PARAMS } as Partial<typeof BASE_PARAMS>;
    delete rest.MerchantTradeNo;
    const res = await POST(buildRequest(rest as Record<string, string>));
    expect(await res.text()).toBe("0|MerchantTradeNo missing");
  });
});

// ---------------------------------------------------------------------------
// 付款成功路徑（payment row 已由 pay page 預建）
// ---------------------------------------------------------------------------

describe("RtnCode=1 且 payment=pending", () => {
  it("payment 更新為 paid、orders pending_payment→paid、寫 status log、寄兩封信、回 1|OK", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    const paymentUpdate = updatesTo("payment")[0]?.values as any;
    expect(paymentUpdate.status).toBe("paid");
    expect(paymentUpdate.gateway_trade_no).toBe(BASE_PARAMS.TradeNo);
    const orderUpdate = updatesTo("orders")[0]?.values as any;
    expect(orderUpdate.status).toBe("paid");
    expect(insertsTo("order_status_log")).toHaveLength(1);
    expect(sendOrderConfirmation).toHaveBeenCalledWith("o1");
    expect(sendNewOrderNotification).toHaveBeenCalledWith("o1");
  });

  it("訂單已非 pending_payment（狀態守衛）→ 不寫 status log、不寄信，仍回 1|OK", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "cancelled";

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    expect(insertsTo("order_status_log")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it("通知投遞失敗（sendOnce 回 false）→ 訂單／付款仍推進成功，但回 0|... 觸發 ECPay 重送（T88）", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "pending_payment";
    sendOnceResult = { order_confirmation: false };

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|notification delivery failed");
    // 訂單與付款已正確推進，回 ERR 只是請 ECPay 重送、不影響已完成的金流狀態。
    const paymentUpdate = updatesTo("payment")[0]?.values as any;
    expect(paymentUpdate.status).toBe("paid");
    const orderUpdate = updatesTo("orders")[0]?.values as any;
    expect(orderUpdate.status).toBe("paid");
  });
});

// ---------------------------------------------------------------------------
// 冪等（T53）與自我修復（T68 review round 3：ensureOrderPaid / ensureNotificationSent）
// ---------------------------------------------------------------------------

describe("冪等：payment 已是 paid", () => {
  it("orders 也已經是 paid（完全做完）→ 不重複寫 log，但仍確保通知已寄出", async () => {
    db.payment = { id: "p1", status: "paid", order_id: "o1", amount: 25000 };
    db.orderStatus = "paid";

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    expect(insertsTo("order_status_log")).toHaveLength(0);
    expect(sendOrderConfirmation).toHaveBeenCalledWith("o1");
    expect(sendNewOrderNotification).toHaveBeenCalledWith("o1");
  });

  it("orders 還沒有任何紀錄（極端情況）→ 不寄信", async () => {
    db.payment = { id: "p1", status: "paid", order_id: "o1", amount: 25000 };
    // db.orderStatus 維持 null：模擬查無此訂單的極端情況

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
    expect(sendNewOrderNotification).not.toHaveBeenCalled();
  });

  it("orders 還卡在 pending_payment（上次執行半路失敗）→ 補做推進與通知，不再默默 no-op", async () => {
    db.payment = { id: "p1", status: "paid", order_id: "o1", amount: 25000 };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    const orderUpdate = updatesTo("orders")[0]?.values as any;
    expect(orderUpdate.status).toBe("paid");
    expect(insertsTo("order_status_log")).toHaveLength(1);
    expect(sendOrderConfirmation).toHaveBeenCalledWith("o1");
    expect(sendNewOrderNotification).toHaveBeenCalledWith("o1");
  });

  it("補寄通知仍失敗（sendOnce 回 false）→ 冪等路徑也要回 0|... 觸發重送，不得從這裡漏回 1|OK（T88 review：四個入口都要守住）", async () => {
    // 這正是 T88 的核心情境：第一次 webhook 信寄失敗回 ERR，ECPay 重送時
    // payment 已是 paid、走這條冪等路徑——若這裡回 1|OK，重試迴路就斷了。
    db.payment = { id: "p1", status: "paid", order_id: "o1", amount: 25000 };
    db.orderStatus = "paid";
    sendOnceResult = { order_confirmation: false };

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|notification delivery failed");
  });
});

describe("冪等：fallback 路徑，已有其他 paid payment", () => {
  it("orders 還卡在 pending_payment（上次執行半路失敗）→ 補做推進與通知", async () => {
    db.payment = null; // 這個 merchant_trade_no 對應不到既有 payment row
    db.paidPayment = { id: "p-other" }; // 但這張訂單已經有「別的」payment row 是 paid
    db.order = { id: "o1", total_amount: 25000 };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    const orderUpdate = updatesTo("orders")[0]?.values as any;
    expect(orderUpdate.status).toBe("paid");
    expect(insertsTo("order_status_log")).toHaveLength(1);
    expect(sendOrderConfirmation).toHaveBeenCalledWith("o1");
    expect(sendNewOrderNotification).toHaveBeenCalledWith("o1");
  });

  it("補寄通知仍失敗（sendOnce 回 false）→ 回 0|... 觸發重送（T88 review：四個入口都要守住）", async () => {
    db.payment = null;
    db.paidPayment = { id: "p-other" };
    db.order = { id: "o1", total_amount: 25000 };
    db.orderStatus = "paid";
    sendOnceResult = { new_order_notification: false };

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|notification delivery failed");
  });
});

describe("fallback 路徑：payment row 需現場補建（pay page 預建失敗）", () => {
  it("補建 payment＋推進成功，但通知投遞失敗 → 回 0|... 觸發重送（T88 review：四個入口都要守住）", async () => {
    db.payment = null;
    db.paidPayment = null;
    db.order = { id: "o1", total_amount: 25000 };
    db.orderStatus = "pending_payment";
    sendOnceResult = { order_confirmation: false };

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|notification delivery failed");
    // 金流面已完成：payment 補建為 paid、訂單推進 paid，ERR 只是請 ECPay 重送。
    const paymentInsert = insertsTo("payment")[0]?.values as any;
    expect(paymentInsert.status).toBe("paid");
    const orderUpdate = updatesTo("orders")[0]?.values as any;
    expect(orderUpdate.status).toBe("paid");
  });
});

// ---------------------------------------------------------------------------
// 付款失敗路徑
// ---------------------------------------------------------------------------

describe("RtnCode≠1（付款失敗）", () => {
  it("payment 更新為 failed、訂單狀態不動、不寄信、回 1|OK", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "pending_payment";

    const res = await POST(
      buildRequest({ ...BASE_PARAMS, RtnCode: "10100252", RtnMsg: "拒絕交易" }),
    );

    expect(await res.text()).toBe("1|OK");
    const paymentUpdate = updatesTo("payment")[0]?.values as any;
    expect(paymentUpdate.status).toBe("failed");
    expect(paymentUpdate.paid_at).toBeNull();
    expect(updatesTo("orders")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it("K5 fallback 失敗回呼（TradeAmt 缺失）→ 用 order.total_amount 建 failed payment（不 insert 0/NaN 撞 CHECK）", async () => {
    // 無預建 payment（走 fallback）、訂單存在、RtnCode≠1（失敗）、TradeAmt 缺失。
    db.payment = null;
    db.order = { id: "o1", total_amount: 25000 };
    db.orderStatus = "pending_payment";

    const params = { ...BASE_PARAMS, RtnCode: "10100252", RtnMsg: "拒絕交易" };
    delete (params as Partial<typeof params>).TradeAmt;

    const res = await POST(buildRequest(params));

    expect(await res.text()).toBe("1|OK");
    // 失敗回呼的金額無意義，改用訂單金額（必為正、過 amount>0 CHECK），
    // 不會用 0/NaN insert 導致靜默失敗＋ECPay 空轉重送。
    const insert = insertsTo("payment")[0]?.values as any;
    expect(insert.status).toBe("failed");
    expect(insert.amount).toBe(25000);
  });
});

describe("K14：lookup 查詢回 { error } 必須當故障處理（非查無資料）", () => {
  it("payment lookup {error} → 回 0|Internal Error（觸發重送），不誤走 fallback", async () => {
    db.paymentSelectError = true;

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|Internal Error");
    // 不因誤判「查無 payment」而 insert 一筆新 payment。
    expect(insertsTo("payment")).toHaveLength(0);
  });

  it("fallback 訂單 lookup {error} → 回 0|Internal Error（非 0|Order not found）", async () => {
    db.payment = null; // 走 fallback
    db.ordersSelectError = true;

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|Internal Error");
  });
});

// ---------------------------------------------------------------------------
// 外層 catch-all（T68）
// ---------------------------------------------------------------------------

describe("未預期例外", () => {
  it("DB 查詢丟例外 → 回 0|Internal Error（觸發 ECPay 重送），不再默默回 1|OK", async () => {
    db.throwOnPaymentQuery = true;

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|Internal Error");
  });
});

// ---------------------------------------------------------------------------
// 金額核對（T68）
// ---------------------------------------------------------------------------

describe("金額核對", () => {
  it("正常路徑：TradeAmt 與 payment.amount 不符 → 回 ERR、不更新、不寄信", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 30000 };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|Amount mismatch");
    expect(updatesTo("payment")).toHaveLength(0);
    expect(updatesTo("orders")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
    expect(sendNewOrderNotification).not.toHaveBeenCalled();
  });

  it("fallback 路徑：TradeAmt 與 order.total_amount 不符 → 回 ERR、不建立 payment、不寄信", async () => {
    db.payment = null;
    db.order = { id: "o1", total_amount: 99999 };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|Amount mismatch");
    expect(insertsTo("payment")).toHaveLength(0);
    expect(updatesTo("orders")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it("fallback 路徑：金額相符 → 正常補建 payment、標記 paid、寄兩封信", async () => {
    db.payment = null;
    db.order = { id: "o1", total_amount: 25000 };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    const paymentInsert = insertsTo("payment")[0]?.values as any;
    expect(paymentInsert.status).toBe("paid");
    const orderUpdate = updatesTo("orders")[0]?.values as any;
    expect(orderUpdate.status).toBe("paid");
    expect(sendOrderConfirmation).toHaveBeenCalledWith("o1");
    expect(sendNewOrderNotification).toHaveBeenCalledWith("o1");
  });
});

// ---------------------------------------------------------------------------
// numeric 欄位以字串型別回傳時仍需正確比對（PostgREST numeric-as-string 防線）
// ---------------------------------------------------------------------------

describe("金額核對：numeric 欄位為字串型別", () => {
  it('正常路徑：payment.amount 為字串 "25000" 且與 TradeAmt 相符 → 仍標記 paid、寄信', async () => {
    db.payment = {
      id: "p1",
      status: "pending",
      order_id: "o1",
      amount: "25000" as unknown as number,
    };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    const paymentUpdate = updatesTo("payment")[0]?.values as any;
    expect(paymentUpdate.status).toBe("paid");
    expect(sendOrderConfirmation).toHaveBeenCalledWith("o1");
  });

  it('fallback 路徑：order.total_amount 為字串 "25000" 且與 TradeAmt 相符 → 仍標記 paid、寄信', async () => {
    db.payment = null;
    db.order = {
      id: "o1",
      total_amount: "25000" as unknown as number,
    };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    const orderUpdate = updatesTo("orders")[0]?.values as any;
    expect(orderUpdate.status).toBe("paid");
    expect(sendOrderConfirmation).toHaveBeenCalledWith("o1");
  });
});

// ---------------------------------------------------------------------------
// TradeAmt 格式異常（NaN 防呆）
// ---------------------------------------------------------------------------

describe("金額核對：TradeAmt 格式異常", () => {
  it("TradeAmt 為空字串 → parseInt 得到 NaN，明確擋下、不誤判為金額相符", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest({ ...BASE_PARAMS, TradeAmt: "" }));

    expect(await res.text()).toBe("0|Amount mismatch");
    expect(updatesTo("payment")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 金額正數防呆（T127③，與 reconcile 對稱）：0===0／負數不得視為吻合
// ---------------------------------------------------------------------------

describe("金額核對：正數防呆（T127③）", () => {
  it("正常路徑：TradeAmt=0 且 payment.amount=0（雙零）→ 回 ERR、不更新、不寄信", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 0 };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest({ ...BASE_PARAMS, TradeAmt: "0" }));

    expect(await res.text()).toBe("0|Amount mismatch");
    expect(updatesTo("payment")).toHaveLength(0);
    expect(updatesTo("orders")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it("fallback 路徑：TradeAmt=0 且 order.total_amount=0（雙零）→ 回 ERR、不 insert amount=0 的 paid payment、不寄信", async () => {
    db.payment = null;
    db.order = { id: "o1", total_amount: 0 };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest({ ...BASE_PARAMS, TradeAmt: "0" }));

    expect(await res.text()).toBe("0|Amount mismatch");
    expect(insertsTo("payment")).toHaveLength(0);
    expect(updatesTo("orders")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it("負數 TradeAmt（parseInt 可解析、isFinite 過）即使與記錄金額相等 → 仍擋下", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: -100 };
    db.orderStatus = "pending_payment";

    const res = await POST(buildRequest({ ...BASE_PARAMS, TradeAmt: "-100" }));

    expect(await res.text()).toBe("0|Amount mismatch");
    expect(updatesTo("payment")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 並發保護：ensureOrderPaid 的 CAS（T68 review round 2/3；T110 起走
// transition_order_status RPC）
// ---------------------------------------------------------------------------

describe("並發：ensureOrderPaid 沒搶到推進（已被其他並發請求搶先完成）", () => {
  it("正常路徑：沒搶到推進 → 不重複寫 log，但仍確保通知已寄出", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "paid"; // 模擬已經被另一個並發請求搶先推進成 paid
    db.orderRaceLost = true; // 這次的條件式 UPDATE 因此搶不到

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    expect(insertsTo("order_status_log")).toHaveLength(0);
    expect(sendOrderConfirmation).toHaveBeenCalledWith("o1");
    expect(sendNewOrderNotification).toHaveBeenCalledWith("o1");
  });

  it("fallback 路徑：同上情境", async () => {
    db.payment = null;
    db.order = { id: "o1", total_amount: 25000 };
    db.orderStatus = "paid";
    db.orderRaceLost = true;

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    expect(insertsTo("order_status_log")).toHaveLength(0);
    expect(sendOrderConfirmation).toHaveBeenCalledWith("o1");
  });
});

// ---------------------------------------------------------------------------
// T74 競態救援：付款頁把 payment 標成 failed 的同時客人完成付款
// ---------------------------------------------------------------------------

describe("T74 競態：payment 被付款頁標成 failed 後 webhook 才抵達", () => {
  it("第一段 CAS 沒更新到列 → 從 failed 救回 paid（補齊 ECPay 交易資訊），訂單仍正常推進", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "pending_payment";
    db.paymentUpdateMatches = false; // 讀到時還是 pending，UPDATE 前被標成 failed
    db.paymentRescueMatches = true;

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    const paymentUpdates = updatesTo("payment");
    expect(paymentUpdates).toHaveLength(2); // 第一段 CAS ＋ 救援
    const rescue = paymentUpdates[1]?.values as any;
    expect(rescue.status).toBe("paid");
    expect(rescue.gateway_trade_no).toBe(BASE_PARAMS.TradeNo);
    expect(rescue.raw_callback).toBeTruthy();
    const orderUpdate = updatesTo("orders")[0]?.values as any;
    expect(orderUpdate.status).toBe("paid");
    expect(sendOrderConfirmation).toHaveBeenCalledWith("o1");
  });

  it("救援也沒更新到列（已有其他 paid row 等）→ 不擋流程，訂單仍推進、回 1|OK", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "pending_payment";
    db.paymentUpdateMatches = false;
    db.paymentRescueMatches = false;

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    const orderUpdate = updatesTo("orders")[0]?.values as any;
    expect(orderUpdate.status).toBe("paid");
  });

  it("付款失敗通知（RtnCode≠1）遇 0 列更新 → 不觸發救援（救援只為 isPaid 服務）", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "pending_payment";
    db.paymentUpdateMatches = false;

    const res = await POST(
      buildRequest({ ...BASE_PARAMS, RtnCode: "10100252", RtnMsg: "拒絕交易" }),
    );

    expect(await res.text()).toBe("1|OK");
    expect(updatesTo("payment")).toHaveLength(1); // 只有第一段，沒有救援
    expect(updatesTo("orders")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureOrderPaid / ensureNotificationSent 需檢查 Supabase 的 { error }
// （ultrareview 第二輪 bug_002：暫時性 DB 錯誤不會 throw，只回傳 { error }，
// 若不檢查會被誤判為「沒符合更新條件」而靜默跳過，讓 webhook 錯誤回 1|OK。
// T110 起 ensureOrderPaid 的 CAS 走 transition_order_status RPC，{ error }
// 亦涵蓋「log 寫入失敗整段 rollback」）
// ---------------------------------------------------------------------------

describe("ensureOrderPaid / ensureNotificationSent 的 Supabase 錯誤處理", () => {
  it("ensureOrderPaid 的 transition RPC 回傳 { error }（非 throw）→ 回 0|Internal Error，不靜默跳過", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "pending_payment";
    db.ordersUpdateError = true;

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|Internal Error");
    expect(insertsTo("order_status_log")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it("ensureNotificationSent 的狀態查詢回傳 { error }（非 throw）→ 回 0|Internal Error，不靜默跳過", async () => {
    // payment 已是 paid（走冪等短路，ensureOrderPaid 因訂單已非 pending_payment
    // 而安全跳過、不觸發 ordersUpdateError），接著呼叫 ensureNotificationSent
    // 查詢 orders.status 時遇到 { error }。
    db.payment = { id: "p1", status: "paid", order_id: "o1", amount: 25000 };
    db.orderStatus = "paid";
    db.ordersSelectError = true;

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|Internal Error");
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
    expect(sendNewOrderNotification).not.toHaveBeenCalled();
  });

  it("正常路徑的 payment UPDATE 回傳 { error }（非 throw）→ 回 0|Internal Error，不繼續推進訂單／寄信（ultrareview 第三輪 bug_001）", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "pending_payment";
    db.paymentUpdateError = true;

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|Internal Error");
    expect(updatesTo("orders")).toHaveLength(0);
    expect(insertsTo("order_status_log")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
    expect(sendNewOrderNotification).not.toHaveBeenCalled();
  });
});
