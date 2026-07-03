/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

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

// sendOnce：T69 的去重/重試邏輯已在 send-once.test.ts 獨立覆蓋，
// 這裡當依賴邊界整個 mock 掉，pass-through 呼叫 send() 即可，
// 讓既有的 sendOrderConfirmation/sendNewOrderNotification 斷言不用改。
const sendOnce = vi.fn(
  async (_sr: unknown, p: { send: () => Promise<void> }) => {
    await p.send();
  },
);
vi.mock("@/lib/notification/send-once", () => ({
  sendOnce: (...args: unknown[]) =>
    sendOnce(...(args as [unknown, { send: () => Promise<void> }])),
}));

// service role mock：以「呼叫記錄器」記下所有 update/insert，供斷言副作用
type DbState = {
  payment: {
    id: string;
    status: string;
    order_id: string;
    amount: number;
  } | null;
  orderStatus: string | null;
  order: { id: string; status: string; total_amount: number } | null;
  throwOnPaymentQuery: boolean;
};
const db: DbState = {
  payment: null,
  orderStatus: null,
  order: null,
  throwOnPaymentQuery: false,
};
const recorded: { table: string; op: string; values?: unknown }[] = [];

function makeServiceRole() {
  return {
    from: (table: string) => makeChain(table),
  };
}

function makeChain(table: string) {
  const chain: any = {
    _op: "select",
    _values: undefined as unknown,
    select: () => chain,
    update: (values: unknown) => {
      chain._op = "update";
      chain._values = values;
      recorded.push({ table, op: "update", values });
      return chain;
    },
    insert: (values: unknown) => {
      recorded.push({ table, op: "insert", values });
      return Promise.resolve({ error: null });
    },
    eq: () => chain,
    maybeSingle: () => {
      if (table === "payment") {
        if (db.throwOnPaymentQuery) {
          throw new Error("simulated DB failure");
        }
        return Promise.resolve({ data: db.payment });
      }
      if (table === "orders") {
        return Promise.resolve({ data: db.order });
      }
      return Promise.resolve({ data: null });
    },
    single: () =>
      Promise.resolve({
        data: table === "orders" ? { status: db.orderStatus } : null,
      }),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
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
  db.orderStatus = null;
  db.order = null;
  db.throwOnPaymentQuery = false;
  sendOrderConfirmation.mockClear();
  sendNewOrderNotification.mockClear();
  sendOnce.mockClear();
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

  it("訂單已非 pending_payment（狀態守衛）→ 不再推進訂單狀態、不寄信，仍回 1|OK", async () => {
    db.payment = { id: "p1", status: "pending", order_id: "o1", amount: 25000 };
    db.orderStatus = "cancelled";

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    expect(updatesTo("orders")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 冪等（T53）
// ---------------------------------------------------------------------------

describe("冪等：payment 已是 paid", () => {
  it("重送同一通知 → 直接 1|OK、零副作用（不更新、不寄信）", async () => {
    db.payment = { id: "p1", status: "paid", order_id: "o1", amount: 25000 };

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("1|OK");
    expect(recorded).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
    expect(sendNewOrderNotification).not.toHaveBeenCalled();
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
    db.order = { id: "o1", status: "pending_payment", total_amount: 99999 };

    const res = await POST(buildRequest(BASE_PARAMS));

    expect(await res.text()).toBe("0|Amount mismatch");
    expect(insertsTo("payment")).toHaveLength(0);
    expect(updatesTo("orders")).toHaveLength(0);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it("fallback 路徑：金額相符 → 正常補建 payment、標記 paid、寄兩封信", async () => {
    db.payment = null;
    db.order = { id: "o1", status: "pending_payment", total_amount: 25000 };

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
