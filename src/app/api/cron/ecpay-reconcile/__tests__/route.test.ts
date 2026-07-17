/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Sentry mock：promotedOnClosedOrder 的新訊號需鎖訊息與 level（error），其餘
// 測試不斷言 Sentry——route 的行為已由 summary 計數鎖住。
const { sentryCaptureMessage } = vi.hoisted(() => ({
  sentryCaptureMessage: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
  captureException: vi.fn(),
}));

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
const { queryTradeInfo, RateLimitError, QueryTradeInfoHttpError } = vi.hoisted(
  () => {
    // status 對齊真實 RateLimitError（#1）：403 走連續計數升級路徑。
    class RateLimitError extends Error {
      constructor(
        message?: string,
        readonly status?: number,
      ) {
        super(message);
      }
    }
    class QueryTradeInfoHttpError extends Error {
      constructor(readonly status: number) {
        super(`QueryTradeInfo 非 200 回應：${status}`);
      }
    }
    return { queryTradeInfo: vi.fn(), RateLimitError, QueryTradeInfoHttpError };
  },
);
vi.mock("@/lib/ecpay/query-trade-info", () => ({
  queryTradeInfo: (...args: unknown[]) => queryTradeInfo(...(args as [string])),
  RateLimitError,
  QueryTradeInfoHttpError,
}));

// #1：reconcile 用 @/lib/redis 做連續-403 計數；mock incr/del 供斷言與 fail-open。
const { redisIncr, redisDel } = vi.hoisted(() => ({
  redisIncr: vi.fn(),
  redisDel: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({
  redis: {
    incr: (...a: unknown[]) => redisIncr(...a),
    del: (...a: unknown[]) => redisDel(...a),
  },
}));

// ensureOrderPaid / ensureNotificationSent 的行為已在
// notify/__tests__/route.test.ts 完整覆蓋；這裡當依賴邊界整個 mock 掉。
// ensureNotificationSent 預設回傳 true（T88：投遞成功／無事可寄），個別測試
// 可用 mockResolvedValueOnce(false) 覆寫，驗證投遞失敗時 reconcile 只告警、
// 不中止批次、不回 500。
const { ensureOrderPaid, ensureNotificationSent } = vi.hoisted(() => ({
  ensureOrderPaid: vi.fn().mockResolvedValue("promoted"),
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

// 發票補開的核心邏輯已在 issue-invoice.test.ts 完整覆蓋；這裡當依賴邊界
// mock 掉，專注驗證 sweep 的查詢條件與摘要計數。
const { issueInvoiceForOrder } = vi.hoisted(() => ({
  issueInvoiceForOrder: vi.fn(),
}));
vi.mock("@/lib/order/issue-invoice", () => ({
  issueInvoiceForOrder: (...args: unknown[]) => issueInvoiceForOrder(...args),
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
// 模擬 promote 的 CAS UPDATE 回傳 { error }（暫時性 DB 故障）：payment 在
// 真實 DB 不會被寫入、留在 pending。
let casErrorIds = new Set<string>();
// 模擬 last_reconciled_at 那支 UPDATE 回傳 { error }（暫時性 DB 故障）。
let lastReconciledError: string | null = null;
// 捕捉候選查詢傳給 .or() 的實際字串，供斷言格式正確（PostgREST 要求值裡的
// 句點／逗號等保留字元須用雙引號包住，否則解析會跑掉——sandbox 端到端驗證
// 實測到這個 bug，這裡的 mock 之前完全忽略引數、測不出這種格式錯誤）。
let lastOrFilter: string | undefined;
// sweep 用：notification 表的 failed 紀錄與 orders 表的狀態查詢結果。
let failedNotifications: { id: string; order_id: string; type: string }[] = [];
let sweepOrders: { id: string; status: string }[] = [];

// T42 sweep：orders 表的「已付款未開票」候選（預設空）。
const uninvoicedOrders: { id: string }[] = [];
// 捕捉 sweep 查詢實際帶的過濾條件，斷言只撈 paid＋invoice_status='none'。
const lastOrdersFilters: Record<string, unknown> = {};

// T110 分歧 sweep 用：pending_payment 訂單清單，及其中已有 paid payment 的
// order_id 清單。
let pendingDivergedOrders: { id: string }[] = [];
let paidDivergedPayments: { order_id: string }[] = [];

// orders 表被三種查詢用到，形狀不同以此分流：
// T88 通知 sweep 用 .in("id",[...]) 撈訂單狀態 → 回 sweepOrders；
// T110 分歧 sweep 用 .eq("status","pending_payment").lt().order().limit() →
//   回 pendingDivergedOrders；
// T42 發票 sweep 用 .eq("status","paid").eq("invoice_status","none")… →
//   回 uninvoicedOrders（並側錄 eq 過濾條件供斷言）。
function makeOrdersChain() {
  let usedIn = false;
  const filters: Record<string, unknown> = {};
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return chain;
    },
    in: () => {
      usedIn = true;
      return chain;
    },
    lt: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown) => void) => {
      if (usedIn) {
        resolve({ data: sweepOrders, error: null });
        return;
      }
      if (filters.status === "pending_payment") {
        resolve({ data: pendingDivergedOrders, error: null });
        return;
      }
      // T42 發票 sweep：側錄過濾條件供斷言。
      lastOrdersFilters.status = filters.status;
      lastOrdersFilters.invoice_status = filters.invoice_status;
      resolve({ data: uninvoicedOrders, error: null });
    },
  };
  return chain;
}

function makeServiceRole() {
  return {
    from: (table: string) => {
      if (table === "payment") return makeChain();
      if (table === "notification") return makeSweepChain(failedNotifications);
      if (table === "orders") return makeOrdersChain();
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
    _usedIn: false,
    _filters: {} as Record<string, unknown>,
    select: () => chain,
    eq: (col: string, val: unknown) => {
      chain._filters[col] = val;
      return chain;
    },
    // T110 分歧 sweep 的 paid-payment 查詢：.in("order_id",[...]).eq("status","paid")
    in: (col: string, val: unknown) => {
      chain._filters[col] = val;
      chain._usedIn = true;
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
      if (id && casErrorIds.has(id)) {
        return Promise.resolve({
          data: null,
          error: { message: "simulated CAS update failure" },
        });
      }
      if (id && casLossIds.has(id)) {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: id ? { id } : null, error: null });
    },
    then: (resolve: (v: unknown) => void) => {
      if (chain._op === "select") {
        // T110 分歧 sweep 的 paid-payment 查詢：以 .in + status='paid' 分流。
        if (chain._usedIn && chain._filters.status === "paid") {
          resolve({ data: paidDivergedPayments, error: null });
          return;
        }
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
  casErrorIds = new Set();
  lastReconciledError = null;
  lastOrFilter = undefined;
  failedNotifications = [];
  sweepOrders = [];
  pendingDivergedOrders = [];
  paidDivergedPayments = [];
  queryTradeInfo.mockReset();
  // mockReset 而非 mockClear：mockClear 不會清掉前一個測試殘留、未被消耗的
  // mockResolvedValueOnce 佇列，會外洩到下一個測試造成順序相依的 flaky。
  // reset 後重新掛預設值。
  ensureOrderPaid.mockReset();
  // 預設回 "promoted"（四態之一）：健康搶救路徑。個別測試可覆寫成
  // "closed"／"indeterminate"／"already-settled" 驗證分類與訊號分流。
  ensureOrderPaid.mockResolvedValue("promoted");
  ensureNotificationSent.mockReset();
  ensureNotificationSent.mockResolvedValue(true);
  sendOnce.mockReset();
  sendOnce.mockResolvedValue(true);
  sentryCaptureMessage.mockClear();
  redisIncr.mockReset();
  redisIncr.mockResolvedValue(1);
  redisDel.mockReset();
  redisDel.mockResolvedValue(1);
  uninvoicedOrders.length = 0;
  for (const key of Object.keys(lastOrdersFilters)) {
    delete lastOrdersFilters[key];
  }
  issueInvoiceForOrder.mockReset();
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

  it("Authorization 長度相同但內容錯誤 → 401（timing-safe 比對路徑，T99）", async () => {
    const res = await GET(buildRequest("Bearer test-cron-secreX"));
    expect(res.status).toBe(401);
  });

  it("Authorization 正確但無候選 → 200，摘要全 0", async () => {
    const res = await GET(buildRequest("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      checked: 0,
      promoted: 0,
      promotedOnClosedOrder: 0,
      mismatches: 0,
      failed: 0,
      unexpected: 0,
      notifyFailed: 0,
      sweepRetried: 0,
      sweepSent: 0,
      sweepStillFailing: 0,
      rateLimited: false,
      httpAborted: false,
      invoicesSwept: 0,
      invoicesIssued: 0,
      invoicesFailed: 0,
      divergedRescued: 0,
    });
  });
});

describe("T42 發票補開 sweep", () => {
  it("查詢條件＝status='paid' 且 invoice_status='none'", async () => {
    await GET(buildRequest("Bearer test-cron-secret"));
    expect(lastOrdersFilters).toEqual({
      status: "paid",
      invoice_status: "none",
    });
  });

  it("候選逐筆呼叫 issueInvoiceForOrder，成功/失敗分別計數", async () => {
    uninvoicedOrders.push({ id: "o1" }, { id: "o2" });
    issueInvoiceForOrder
      .mockResolvedValueOnce({ ok: true, invoiceNo: "AB11111111" })
      .mockResolvedValueOnce({ ok: false, error: "ECPay 5000000" });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(issueInvoiceForOrder).toHaveBeenCalledTimes(2);
    expect(body.invoicesSwept).toBe(2);
    expect(body.invoicesIssued).toBe(1);
    expect(body.invoicesFailed).toBe(1);
  });

  it("無未開票訂單 → 不呼叫 issueInvoiceForOrder", async () => {
    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();
    expect(issueInvoiceForOrder).not.toHaveBeenCalled();
    expect(body.invoicesSwept).toBe(0);
  });
});

describe("T110 分歧兜底 sweep（payment=paid 但 order 卡 pending_payment）", () => {
  it("分歧訂單 → 補推進 ensureOrderPaid('reconcile-diverged')、補寄通知、divergedRescued+1、error 告警", async () => {
    pendingDivergedOrders = [{ id: "o1" }];
    paidDivergedPayments = [{ order_id: "o1" }]; // webhook 已收款、訂單卻卡 pending

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.divergedRescued).toBe(1);
    expect(ensureOrderPaid).toHaveBeenCalledWith(
      expect.anything(),
      "o1",
      "reconcile-diverged",
    );
    // 補寄 webhook 當初沒寄成的確認信。
    expect(ensureNotificationSent).toHaveBeenCalledWith(
      expect.anything(),
      "o1",
    );
    // 異常態：error 級告警。
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "reconcile: paid payment on pending_payment order — rescuing (T110 divergence)",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("pending_payment 訂單但無 paid payment（正常待付款）→ 不補推進、divergedRescued=0", async () => {
    pendingDivergedOrders = [{ id: "o1" }];
    paidDivergedPayments = []; // 沒有 paid payment：正常待付款，非分歧

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.divergedRescued).toBe(0);
    expect(ensureOrderPaid).not.toHaveBeenCalled();
  });

  it("補推進失敗（ensureOrderPaid throw，order_status_log 仍寫不進）→ 不計 divergedRescued、unexpected+1、續留 pending 隔日再試", async () => {
    pendingDivergedOrders = [{ id: "o1" }];
    paidDivergedPayments = [{ order_id: "o1" }];
    ensureOrderPaid.mockRejectedValueOnce(
      new Error("ensureOrderPaid failed: simulated"),
    );

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.divergedRescued).toBe(0);
    expect(body.unexpected).toBe(1);
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

  it("順序（T107/F-014）：ensureOrderPaid 先執行、payment 翻 paid 是最後一步", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 25000,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });
    // 不能在 mock 內直接 expect：throw 會被 route 的 try/catch 吃掉、測試
    // 反而綠。改成把「ensureOrderPaid 被呼叫當下是否已有 paid UPDATE」記
    // 下來，事後斷言。
    let paidUpdateBeforeEnsure: boolean | null = null;
    ensureOrderPaid.mockImplementation(async () => {
      paidUpdateBeforeEnsure = recorded.some(
        (r) => (r.values as any)?.status === "paid",
      );
      // 分類掛在①的回傳上：這裡照樣回真實情境的 "promoted"，下方的
      // promoted 計數斷言才有意義。
      return "promoted";
    });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(paidUpdateBeforeEnsure).toBe(false);
    expect(body.promoted).toBe(1);
  });

  it("ensureOrderPaid 拋例外 → 不得翻 payment（候選鍵保留隔日重試）、unexpected +1、批次繼續（F-014 反向驗證）", async () => {
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
    ensureOrderPaid.mockRejectedValueOnce(
      new Error("ensureOrderPaid failed: simulated"),
    );

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    // 舊版先翻 payment 再推進訂單：推進失敗時候選鍵（status='pending'）已被
    // 消滅，隔日 cron 永遠選不到——訂單永久卡 pending_payment。新順序下 p1
    // 絕不可出現 status='paid' 的 UPDATE。
    expect(res.status).toBe(200);
    expect(
      recorded.some(
        (r) => r.filters.id === "p1" && (r.values as any)?.status === "paid",
      ),
    ).toBe(false);
    expect(body.unexpected).toBe(1);
    expect(body.checked).toBe(2);
    // 第二筆不受影響，照常推進＋翻 paid。
    expect(body.promoted).toBe(1);
    // p1 推進失敗也不該寄信（訂單仍 pending_payment）；只有 o2 該寄。
    expect(ensureNotificationSent).toHaveBeenCalledTimes(1);
    expect(ensureNotificationSent).toHaveBeenCalledWith(
      expect.anything(),
      "o2",
    );
  });

  it("CAS 失敗後隔日重跑收斂：訂單已 paid、payment 留 pending → 第二天 ①冪等 no-op、CAS 補翻成功", async () => {
    // 失敗矩陣第②列的兩天劇本。route 無跨次狀態，「隔日」＝再呼叫一次 GET；
    // 「payment 留 pending、隔日被候選重撈」那半段由 Postgres 語意（失敗的
    // UPDATE 不寫入）＋候選查詢條件保證，mock 端以 candidates 維持同一筆表達。
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 25000,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });

    // ① 的真實回傳：第一天真的推進（promoted）、第二天冪等 no-op 撞上
    // 已 paid 的訂單（already-settled）。
    ensureOrderPaid
      .mockResolvedValueOnce("promoted")
      .mockResolvedValueOnce("already-settled");

    // 第一天：CAS 遇暫時性 DB 故障。
    casErrorIds.add("p1");
    const day1 = await (
      await GET(buildRequest("Bearer test-cron-secret"))
    ).json();
    // promoted 掛在①的回傳：搶救發生在第一天，就計在第一天——②的 CAS
    // {error} 只影響 payment 何時補翻，不改變「訂單是這一輪被搶救」的事實。
    expect(day1.promoted).toBe(1);
    expect(day1.unexpected).toBe(1);
    // CAS {error} 不擋③：訂單已 paid（①成功），信該寄。
    expect(ensureNotificationSent).toHaveBeenCalledWith(
      expect.anything(),
      "o1",
    );

    // 第二天：故障排除、候選重撈到同一筆。
    casErrorIds.delete("p1");
    recorded = [];
    const day2 = await (
      await GET(buildRequest("Bearer test-cron-secret"))
    ).json();

    // 第二天只是 payment 補翻（①回 already-settled），不重複計 promoted。
    expect(day2.promoted).toBe(0);
    expect(day2.unexpected).toBe(0);
    expect(
      recorded.some(
        (r) => r.filters.id === "p1" && (r.values as any)?.status === "paid",
      ),
    ).toBe(true);
    // ① 在兩天都被呼叫（第二天於真實環境是冪等 no-op）。
    expect(ensureOrderPaid).toHaveBeenCalledTimes(2);
  });

  it("錢收在已關閉訂單上（ensureOrderPaid 回 closed）→ payment 仍翻 paid（財務事實）、不計 promoted、走 promotedOnClosedOrder＋error 告警", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 25000,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });
    // 訂單已被 T66 逾期取消（cancelled／refunded 等），但綠界確認錢已收到。
    ensureOrderPaid.mockResolvedValueOnce("closed");

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    // payment 照翻 paid：gateway_trade_no／raw_callback 是退款唯一依據，必須落地。
    expect(
      recorded.some(
        (r) => r.filters.id === "p1" && (r.values as any)?.status === "paid",
      ),
    ).toBe(true);
    // 不是健康搶救：不計 promoted、走獨立桶。
    expect(body.promoted).toBe(0);
    expect(body.promotedOnClosedOrder).toBe(1);
    // closed 是分類結果不是故障：不得污染 unexpected／notifyFailed。
    expect(body.unexpected).toBe(0);
    expect(body.notifyFailed).toBe(0);
    // ③照跑（ensureNotificationSent 內部自行判斷已關閉訂單不寄）。
    expect(ensureNotificationSent).toHaveBeenCalledWith(
      expect.anything(),
      "o1",
    );
    // error 級告警，與 warning 的 promoted stuck payment 分流。
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "reconcile: money received on closed order",
      expect.objectContaining({ level: "error" }),
    );
    // 不得發「搶救成功」的 warning 告警。
    expect(sentryCaptureMessage).not.toHaveBeenCalledWith(
      "reconcile: promoted stuck payment",
      expect.anything(),
    );
  });

  it("closed＋② CAS miss（payment 已被別人翻走）→ 告警仍發、promotedOnClosedOrder 仍計、promoted 不計", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    casLossIds.add("p1"); // ② CAS 0 rows：payment 已被 webhook／前一輪翻成 paid
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 25000,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });
    ensureOrderPaid.mockResolvedValueOnce("closed");

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    // 分類掛①不掛②：CAS miss＝payment 是別人翻的，錢一樣收在已關閉訂單
    // 上，P0 告警與計數不得因此消失（R2 review #4 的漏報路徑）。
    expect(body.promotedOnClosedOrder).toBe(1);
    // closed 與 promoted 互斥：鎖住不雙重計數。
    expect(body.promoted).toBe(0);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "reconcile: money received on closed order",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("indeterminate（①無法確認訂單現況）＋② CAS 搶贏 → 維持修前語意：計 promoted＋warning", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 25000,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });
    // ①的訂單 CAS miss、重查又失敗（或查無此單）：無法確認現況。
    ensureOrderPaid.mockResolvedValueOnce("indeterminate");

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    // 保守語意：這一輪確實翻了 payment（② CAS 搶贏）才計 promoted，
    // 不憑「查不到」推論成 closed 啟動錢務裁決。
    expect(body.promoted).toBe(1);
    expect(body.promotedOnClosedOrder).toBe(0);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "reconcile: promoted stuck payment",
      expect.objectContaining({ level: "warning" }),
    );
    expect(sentryCaptureMessage).not.toHaveBeenCalledWith(
      "reconcile: money received on closed order",
      expect.anything(),
    );
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
    // 通知結果不 gate 翻 paid（T107）：payment.status 是財務記錄，寄信失敗
    // 不可讓 gateway_trade_no／raw_callback（退款唯一依據）遲遲不落地。
    expect(
      recorded.some(
        (r) => r.filters.id === "p1" && (r.values as any)?.status === "paid",
      ),
    ).toBe(true);
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
    // 通知在 payment 翻 paid 之後才跑（T107），它的失敗不影響兩筆都翻 paid。
    expect(body.promoted).toBe(2);
  });

  it("並發：webhook 搶先推進（CAS 未命中）→ 不計入 promoted、不發『搶救成功』告警，但仍補做 ensureOrderPaid/ensureNotificationSent", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    casLossIds.add("p1"); // 模擬 webhook 在這次 UPDATE 前就已經把 payment 推進成 paid
    // webhook 已贏＝訂單早已被 webhook 推進，①的真實回傳是 already-settled
    //（分類改掛①後，預設的 "promoted" 會被計數，不再符合此情境）。
    ensureOrderPaid.mockResolvedValueOnce("already-settled");
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

  it("TradeAmt 與 payment.amount 同為 0 → 走 mismatch 分支但發獨立的 zero-amount 告警、不推進", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 0 },
    ];
    queryTradeInfo.mockResolvedValue({
      tradeStatus: "1",
      tradeAmt: 0,
      tradeNo: "T1",
      raw: { TradeStatus: "1" },
    });

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    // 0===0 被正數防呆擋下：絕不可自動改狀態。
    expect(body.mismatches).toBe(1);
    expect(body.promoted).toBe(0);
    expect(ensureOrderPaid).not.toHaveBeenCalled();
    expect(recorded.some((r) => (r.values as any)?.status === "paid")).toBe(
      false,
    );
    // 訊息與真正的金額不符分開：這裡沒有差額可查，是零元 payment 異常。
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "reconcile: zero-amount payment anomaly",
      expect.objectContaining({ level: "error" }),
    );
    expect(sentryCaptureMessage).not.toHaveBeenCalledWith(
      "reconcile: amount mismatch",
      expect.anything(),
    );
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

  it("403 連續達門檻（incr≥3）→ 升級 error 級告警、點名疑似憑證失效（#1）", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockRejectedValueOnce(
      new RateLimitError("QueryTradeInfo 限流回應：403", 403),
    );
    redisIncr.mockResolvedValueOnce(3);

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.rateLimited).toBe(true);
    expect(redisIncr).toHaveBeenCalledWith("reconcile:consecutive-403");
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("疑似 ECPay 金鑰"),
      expect.objectContaining({ level: "error" }),
    );
  });

  it("403 未達門檻（incr=1）→ 維持 warning，不升級（#1）", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockRejectedValueOnce(
      new RateLimitError("QueryTradeInfo 限流回應：403", 403),
    );
    redisIncr.mockResolvedValueOnce(1);

    await GET(buildRequest("Bearer test-cron-secret"));

    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("rate limited (403)"),
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("Redis 掛（incr throw）→ fail-open 當第一次、warning、對帳不崩（#1）", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockRejectedValueOnce(
      new RateLimitError("QueryTradeInfo 限流回應：403", 403),
    );
    redisIncr.mockRejectedValueOnce(new Error("redis down"));

    const res = await GET(buildRequest("Bearer test-cron-secret"));

    expect(res.status).toBe(200);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("rate limited (403)"),
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("有任一筆成功回應 → 清除連續-403 計數，且每次排程至多一次（#1）", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
      { id: "p2", order_id: "o2", merchant_trade_no: "M2", amount: 25000 },
    ];
    queryTradeInfo
      .mockResolvedValueOnce({
        tradeStatus: "1",
        tradeAmt: 25000,
        tradeNo: "T1",
        raw: { TradeStatus: "1" },
      })
      .mockResolvedValueOnce({
        tradeStatus: "1",
        tradeAmt: 25000,
        tradeNo: "T2",
        raw: { TradeStatus: "1" },
      });

    await GET(buildRequest("Bearer test-cron-secret"));

    expect(redisDel).toHaveBeenCalledWith("reconcile:consecutive-403");
    expect(redisDel).toHaveBeenCalledTimes(1);
  });

  it("QueryTradeInfoHttpError（ECPay 5xx）→ 同樣中止整批，但不標 rateLimited（T99）", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
      { id: "p2", order_id: "o2", merchant_trade_no: "M2", amount: 25000 },
    ];
    queryTradeInfo.mockRejectedValueOnce(new QueryTradeInfoHttpError(500));

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.httpAborted).toBe(true);
    expect(body.rateLimited).toBe(false);
    expect(body.checked).toBe(1);
    // 中止路徑不得蓋冷卻戳記，下次排程要能原樣重撈同一筆。
    expect(queryTradeInfo).toHaveBeenCalledTimes(1);
    expect(ensureOrderPaid).not.toHaveBeenCalled();
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
