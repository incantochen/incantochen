/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    ECPAY_MERCHANT_ID: "3002607",
    ECPAY_HASH_KEY: "test-hash-key",
    ECPAY_HASH_IV: "test-hash-iv",
    ECPAY_PAYMENT_URL: "https://payment-stage.example/Cashier/AioCheckOut/V5",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    UPSTASH_REDIS_REST_URL: "http://localhost",
    UPSTASH_REDIS_REST_TOKEN: "test",
    RESEND_API_KEY: "test",
    ADMIN_EMAIL: "admin@example.com",
    CRON_SECRET: "test-cron-secret",
  },
}));

// query-trade-info 已在 src/lib/ecpay/query-trade-info.test.ts 獨立覆蓋；這裡
// 當依賴邊界整個 mock 掉，讓這支測試專注在 reconcile route 自己的決策邏輯上。
// vi.mock 工廠會被 hoist 到檔案最上方，故用 vi.hoisted 讓內部參照的變數安全初始化。
const { queryTradeInfo, RateLimitError } = vi.hoisted(() => {
  class RateLimitError extends Error {}
  return { queryTradeInfo: vi.fn(), RateLimitError };
});
vi.mock("@/lib/ecpay/query-trade-info", () => ({
  queryTradeInfo: (...args: unknown[]) => queryTradeInfo(...(args as [string])),
  RateLimitError,
}));

// ensureOrderPaid / ensureNotificationSent 的行為已在
// notify/__tests__/route.test.ts 完整覆蓋；這裡當依賴邊界整個 mock 掉。
// ensureNotificationSent 預設回傳 true（T88：投遞成功／無事可寄），個別測試
// 可用 mockResolvedValueOnce(false) 覆寫，驗證投遞失敗時 reconcile 只告警、
// 不中止批次、不回 500。
const { ensureOrderPaid, ensureNotificationSent } = vi.hoisted(() => ({
  ensureOrderPaid: vi.fn().mockResolvedValue(undefined),
  ensureNotificationSent: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/order/ensure-paid", () => ({
  ensureOrderPaid: (...args: unknown[]) => ensureOrderPaid(...args),
  ensureNotificationSent: (...args: unknown[]) =>
    ensureNotificationSent(...args),
}));

// sendOnce 的行為已在 send-once.test.ts 完整覆蓋；sweep 這裡只驗證 route 的
// 決策（撈哪些、跳過哪些、計數與告警），依賴邊界整個 mock 掉。
const { sendOnce } = vi.hoisted(() => ({
  sendOnce: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/notification/send-once", () => ({
  sendOnce: (...args: unknown[]) => sendOnce(...args),
}));

// senders 對照表 mock 掉，避免測試載入真實 email 模組（Resend 依賴）。
vi.mock("@/lib/notification/senders", () => ({
  NOTIFICATION_SENDERS: {
    order_confirmation: {
      send: vi.fn(),
      eligibleStatuses: ["paid", "in_production", "shipped", "completed"],
    },
    new_order_notification: {
      send: vi.fn(),
      eligibleStatuses: ["paid", "in_production", "shipped", "completed"],
    },
    order_shipped: {
      send: vi.fn(),
      eligibleStatuses: ["shipped", "completed"],
    },
  },
}));

type PaymentRow = {
  id: string;
  order_id: string;
  merchant_trade_no: string;
  amount: number;
};

let candidates: PaymentRow[] = [];
let recorded: { filters: Record<string, unknown>; values: unknown }[] = [];
// 模擬「webhook 先搶到 CAS」：promote 的 UPDATE...WHERE status='pending' 命中
// 0 rows，但 Supabase 不會回傳 error，只有 .select().maybeSingle() 的 data
// 會是 null。
let casLossIds = new Set<string>();
// 模擬 last_reconciled_at 那支 UPDATE 回傳 { error }（暫時性 DB 故障）。
let lastReconciledError: string | null = null;
// 捕捉候選查詢傳給 .or() 的實際字串，供斷言格式正確（PostgREST 要求值裡的
// 句點／逗號等保留字元須用雙引號包住，否則解析會跑掉——sandbox 端到端驗證
// 實測到這個 bug，這裡的 mock 之前完全忽略引數、測不出這種格式錯誤）。
let lastOrFilter: string | undefined;
// sweep 用：notification 表的 failed 紀錄與 orders 表的狀態查詢結果。
let failedNotifications: { id: string; order_id: string; type: string }[] = [];
let sweepOrders: { id: string; status: string }[] = [];

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table === "payment") return makeChain();
      if (table === "notification") return makeSweepChain(failedNotifications);
      if (table === "orders") return makeSweepChain(sweepOrders);
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

// sweep 的兩段查詢都是純 select，chain 到底 resolve 固定資料即可。
function makeSweepChain(rows: unknown[]) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown) => void) => {
      resolve({ data: rows, error: null });
    },
  };
  return chain;
}

function makeChain() {
  const chain: any = {
    _op: "select",
    _filters: {} as Record<string, unknown>,
    select: () => chain,
    eq: (col: string, val: unknown) => {
      chain._filters[col] = val;
      return chain;
    },
    lt: (col: string, val: unknown) => {
      chain._filters[`${col}__lt`] = val;
      return chain;
    },
    or: (filter: string) => {
      lastOrFilter = filter;
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    update: (values: unknown) => {
      chain._op = "update";
      chain._values = values;
      return chain;
    },
    // 只有 promote 分支的 UPDATE 會接 .select().maybeSingle()，用來判斷這次
    // CAS 是否真的搶到（見 route.ts 的 promotedRow 檢查）。
    maybeSingle: () => {
      recorded.push({ filters: { ...chain._filters }, values: chain._values });
      const id = chain._filters.id as string | undefined;
      if (id && casLossIds.has(id)) {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: id ? { id } : null, error: null });
    },
    then: (resolve: (v: unknown) => void) => {
      if (chain._op === "select") {
        resolve({ data: candidates, error: null });
        return;
      }
      const values = chain._values as Record<string, unknown> | undefined;
      if (values && "last_reconciled_at" in values && lastReconciledError) {
        recorded.push({
          filters: { ...chain._filters },
          values: chain._values,
        });
        resolve({ error: { message: lastReconciledError } });
        return;
      }
      recorded.push({ filters: { ...chain._filters }, values: chain._values });
      resolve({ error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => makeServiceRole(),
}));

import { GET } from "../route";

function buildRequest(auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.authorization = auth;
  return new Request("http://localhost/api/cron/ecpay-reconcile", {
    headers,
  });
}

beforeEach(() => {
  candidates = [];
  recorded = [];
  casLossIds = new Set();
  lastReconciledError = null;
  lastOrFilter = undefined;
  failedNotifications = [];
  sweepOrders = [];
  queryTradeInfo.mockReset();
  // mockReset 而非 mockClear：mockClear 不會清掉前一個測試殘留、未被消耗的
  // mockResolvedValueOnce 佇列，會外洩到下一個測試造成順序相依的 flaky。
  // reset 後重新掛預設值。
  ensureOrderPaid.mockReset();
  ensureOrderPaid.mockResolvedValue(undefined);
  ensureNotificationSent.mockReset();
  ensureNotificationSent.mockResolvedValue(true);
  sendOnce.mockReset();
  sendOnce.mockResolvedValue(true);
});

describe("候選查詢的 .or() 過濾字串格式", () => {
  it("last_reconciled_at 的 ISO timestamp 值必須用雙引號包住（PostgREST 保留句點/逗號）", async () => {
    await GET(buildRequest("Bearer test-cron-secret"));

    expect(lastOrFilter).toBeDefined();
    // 錯誤示範（曾造成 sandbox 驗證撈到錯的候選）：
    //   last_reconciled_at.lt.2026-07-06T14:39:32.580Z   ← 值裡的句點沒包住
    // 正確：值兩端要有雙引號。
    expect(lastOrFilter).toMatch(/last_reconciled_at\.lt\."[^"]+"/);
  });
});

describe("認證", () => {
  it("缺 Authorization header → 401", async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
    expect(queryTradeInfo).not.toHaveBeenCalled();
  });

  it("Authorization 錯誤 → 401", async () => {
    const res = await GET(buildRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("Authorization 正確但無候選 → 200，摘要全 0", async () => {
    const res = await GET(buildRequest("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      checked: 0,
      promoted: 0,
      mismatches: 0,
      failed: 0,
      unexpected: 0,
      notifyFailed: 0,
      sweepRetried: 0,
      sweepSent: 0,
      sweepStillFailing: 0,
      rateLimited: false,
    });
  });
});

describe("單筆候選：TradeStatus=1", () => {
  it("金額吻合 → 標記 paid、呼叫 ensureOrderPaid('reconcile')、寫 last_reconciled_at", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 25000,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.promoted).toBe(1);
    expect(ensureOrderPaid).toHaveBeenCalledWith(
      expect.anything(),
      "o1",
      "reconcile",
    );
    expect(ensureNotificationSent).toHaveBeenCalledWith(
      expect.anything(),
      "o1",
    );

    const statusUpdate = recorded.find(
      (r) => (r.values as any)?.status === "paid",
    );
    expect(statusUpdate).toBeTruthy();
    expect((statusUpdate!.values as any).gateway_trade_no).toBe("T1");

    const reconciledWrites = recorded.filter(
      (r) => (r.values as any)?.last_reconciled_at,
    );
    expect(reconciledWrites.length).toBeGreaterThanOrEqual(1);
  });

  it("通知投遞失敗（ensureNotificationSent 回 false）→ notifyFailed 計數 +1（獨立於 unexpected），不中止批次、不回 500（T88）", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 25000,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });
    ensureNotificationSent.mockResolvedValueOnce(false);

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.promoted).toBe(1);
    // 投遞失敗走獨立的 notifyFailed 桶，不塞 unexpected——日報才能分辨
    // 「資料異常」與「郵件故障」。
    expect(body.notifyFailed).toBe(1);
    expect(body.unexpected).toBe(0);
  });

  it("ensureNotificationSent 拋例外（DB 暫時錯誤）→ 該筆記 unexpected，不中止批次、其餘候選照常處理（T88 review）", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
      { id: "p2", order_id: "o2", merchant_trade_no: "M2", amount: 25000 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 25000,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });
    ensureNotificationSent.mockRejectedValueOnce(
      new Error("ensureNotificationSent failed: simulated"),
    );

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    // 舊版把 ensure 呼叫放在 per-candidate try/catch 之外，單筆 throw 會
    // 直接 500、剩餘候選整天不對帳；現在必須記錄後繼續。
    expect(res.status).toBe(200);
    expect(body.checked).toBe(2);
    expect(body.unexpected).toBe(1);
    expect(ensureOrderPaid).toHaveBeenCalledTimes(2);
  });

  it("並發：webhook 搶先推進（CAS 未命中）→ 不計入 promoted、不發『搶救成功』告警，但仍補做 ensureOrderPaid/ensureNotificationSent", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    casLossIds.add("p1"); // 模擬 webhook 在這次 UPDATE 前就已經把 payment 推進成 paid
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 25000,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.promoted).toBe(0);
    // ensureOrderPaid 自己有冪等 CAS，補呼叫是安全的（webhook 已推進時會安全 no-op）。
    expect(ensureOrderPaid).toHaveBeenCalledWith(
      expect.anything(),
      "o1",
      "reconcile",
    );
    expect(ensureNotificationSent).toHaveBeenCalledWith(
      expect.anything(),
      "o1",
    );
  });

  it("last_reconciled_at 寫入失敗（{error} 非 throw）→ 不吞掉錯誤，仍繼續處理該筆的業務分支", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    lastReconciledError = "simulated DB failure";
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 25000,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    // last_reconciled_at 寫入失敗不應該讓整支 route 掛掉或跳過該筆的業務邏輯。
    expect(res.status).toBe(200);
    expect(body.promoted).toBe(1);
  });

  it("金額不符 → mismatches 計數、不呼叫 ensureOrderPaid、不寫 status=paid", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 30000 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 25000,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.mismatches).toBe(1);
    expect(body.promoted).toBe(0);
    expect(ensureOrderPaid).not.toHaveBeenCalled();
    expect(recorded.some((r) => (r.values as any)?.status === "paid")).toBe(
      false,
    );
  });
});

describe("TradeStatus=10200095（ECPay 官方文件記載的付款失敗碼）", () => {
  it("只告警、不改任何狀態、不呼叫 ensureOrderPaid", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "10200095",
      tradeAmt: NaN,
      tradeNo: null,
      raw: { TradeStatus: "10200095" },
    });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.failed).toBe(1);
    expect(ensureOrderPaid).not.toHaveBeenCalled();
    expect(recorded.some((r) => (r.values as any)?.status === "paid")).toBe(
      false,
    );
  });
});

describe("TradeStatus=0（真的還沒付款）", () => {
  it("不動作，僅計入 checked", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "0",
      tradeAmt: 0,
      tradeNo: null,
      raw: { TradeStatus: "0" },
    });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.checked).toBe(1);
    expect(body.promoted).toBe(0);
    expect(body.mismatches).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.unexpected).toBe(0);
    expect(ensureOrderPaid).not.toHaveBeenCalled();
  });
});

describe("非預期回應", () => {
  it("TradeStatus 缺欄位／非已知值 → unexpected 計數，不動狀態", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "",
      tradeAmt: NaN,
      tradeNo: null,
      raw: {},
    });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.unexpected).toBe(1);
    expect(ensureOrderPaid).not.toHaveBeenCalled();
  });
});

describe("queryTradeInfo 拋例外", () => {
  it("RateLimitError → 中止整批，剩餘候選不再查詢", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
      { id: "p2", order_id: "o2", merchant_trade_no: "M2", amount: 25000 },
    ];
    queryTradeInfo.mockRejectedValueOnce(new RateLimitError("403"));

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.rateLimited).toBe(true);
    expect(body.checked).toBe(1);
    expect(queryTradeInfo).toHaveBeenCalledTimes(1);
  });

  it("一般例外（如驗章失敗）→ 該筆記為 unexpected 並繼續下一筆", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
      { id: "p2", order_id: "o2", merchant_trade_no: "M2", amount: 25000 },
    ];
    queryTradeInfo
      .mockRejectedValueOnce(new Error("CheckMacValue 驗證失敗"))
      .mockResolvedValueOnce({
        tradeStatus: "1",
        tradeAmt: 25000,
        tradeNo: "T2",
        raw: { TradeStatus: "1" },
      });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(queryTradeInfo).toHaveBeenCalledTimes(2);
    expect(body.unexpected).toBe(1);
    expect(body.promoted).toBe(1);
    expect(ensureOrderPaid).toHaveBeenCalledWith(
      expect.anything(),
      "o2",
      "reconcile",
    );
  });
});

describe("failed-notification sweep（T88 過渡版兜底）", () => {
  it("failed 紀錄且訂單狀態適寄 → 呼叫 sendOnce 補寄，計 sweepRetried/sweepSent", async () => {
    failedNotifications = [
      { id: "n1", order_id: "o1", type: "order_confirmation" },
    ];
    sweepOrders = [{ id: "o1", status: "paid" }];

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(sendOnce).toHaveBeenCalledTimes(1);
    expect(sendOnce).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: "o1", type: "order_confirmation" }),
    );
    expect(body.sweepRetried).toBe(1);
    expect(body.sweepSent).toBe(1);
    expect(body.sweepStillFailing).toBe(0);
  });

  it("訂單已推進到 in_production 仍補寄（PAID_LINEAGE，不因狀態推進切斷重試）", async () => {
    failedNotifications = [
      { id: "n1", order_id: "o1", type: "order_confirmation" },
    ];
    sweepOrders = [{ id: "o1", status: "in_production" }];

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(sendOnce).toHaveBeenCalledTimes(1);
    expect(body.sweepSent).toBe(1);
  });

  it("補寄仍失敗（sendOnce 回 false）→ 計 sweepStillFailing、留待明天重試", async () => {
    failedNotifications = [
      { id: "n1", order_id: "o1", type: "order_confirmation" },
    ];
    sweepOrders = [{ id: "o1", status: "paid" }];
    sendOnce.mockResolvedValueOnce(false);

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sweepRetried).toBe(1);
    expect(body.sweepSent).toBe(0);
    expect(body.sweepStillFailing).toBe(1);
  });

  it("訂單已取消 → 不補寄（避免對 cancelled 訂單誤發確認信）", async () => {
    failedNotifications = [
      { id: "n1", order_id: "o1", type: "order_confirmation" },
    ];
    sweepOrders = [{ id: "o1", status: "cancelled" }];

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(sendOnce).not.toHaveBeenCalled();
    expect(body.sweepRetried).toBe(0);
  });

  it("未登記的通知類型 → 跳過不補寄", async () => {
    failedNotifications = [{ id: "n1", order_id: "o1", type: "unknown_type" }];
    sweepOrders = [{ id: "o1", status: "paid" }];

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(sendOnce).not.toHaveBeenCalled();
    expect(body.sweepRetried).toBe(0);
  });

  it("order_shipped 依自己的適寄狀態（shipped/completed）判斷", async () => {
    failedNotifications = [
      { id: "n1", order_id: "o1", type: "order_shipped" },
      { id: "n2", order_id: "o2", type: "order_shipped" },
    ];
    sweepOrders = [
      { id: "o1", status: "shipped" },
      { id: "o2", status: "paid" }, // 還沒出貨：不該寄出貨通知
    ];

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(sendOnce).toHaveBeenCalledTimes(1);
    expect(sendOnce).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: "o1", type: "order_shipped" }),
    );
    expect(body.sweepRetried).toBe(1);
  });

  it("主迴圈 rate limited 中止後，sweep 仍照常執行（兩者互不依賴）", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockRejectedValueOnce(new RateLimitError("403"));
    failedNotifications = [
      { id: "n1", order_id: "o2", type: "order_confirmation" },
    ];
    sweepOrders = [{ id: "o2", status: "paid" }];

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.rateLimited).toBe(true);
    expect(body.sweepSent).toBe(1);
  });
});
