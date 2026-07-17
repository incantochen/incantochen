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
// T127②：漂移臂（payment=paid／orders=pending_payment）的候選。payment 表的
// select 依 .eq("status", …) 的值分流——主迴圈撈 pending、漂移臂撈 paid。
let driftCandidates: {
  id: string;
  order_id: string;
  merchant_trade_no: string;
}[] = [];
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
// T127②：捕捉漂移臂候選查詢的完整形狀（select 的 inner embed、.or() 的
// AND 串接、order 的 nullsFirst）——這些若回歸（漏 embed、閘門掉引號、NULLS
// LAST 把人工列擠出 DRIFT_LIMIT）計數斷言測不出來，必須鎖住實際引數。
let driftQueryCapture:
  | {
      select: string | undefined;
      ors: string[];
      order: { col: string; opts: unknown } | undefined;
      filters: Record<string, unknown>;
      limit: unknown;
    }
  | undefined;
// 主候選查詢（status='pending'）自己的 .or() 捕捉——與漂移臂／稽核臂分開，
// 不用會被後續 .or() 覆蓋的 last-write-wins 全域（否則主臂格式回歸測不出來）。
let mainQueryCapture: { ors: string[] } | undefined;
// #3 recurring 稽核臂（payment=paid ∧ orders=cancelled）的候選與捕捉。
let auditCandidates: {
  id: string;
  order_id: string;
  merchant_trade_no: string;
}[] = [];
let auditQueryCapture:
  | { select: string | undefined; filters: Record<string, unknown> }
  | undefined;
// 候選查詢的 { error } 注入（Conv1 + degraded→500 測試）。
let driftQueryError: string | null = null;
let auditQueryError: string | null = null;
// sweep 用：notification 表的 failed 紀錄與 orders 表的狀態查詢結果。
let failedNotifications: { id: string; order_id: string; type: string }[] = [];
let sweepOrders: { id: string; status: string }[] = [];

// T42 sweep：orders 表的「已付款未開票」候選（預設空）。
const uninvoicedOrders: { id: string }[] = [];
// 捕捉 sweep 查詢實際帶的過濾條件，斷言只撈 paid＋invoice_status='none'。
const lastOrdersFilters: Record<string, unknown> = {};

// orders 表被兩個 sweep 用到，查詢形狀不同，以此分流：
// T88 通知 sweep 用 .in("id",[...]) 撈訂單狀態 → 回 sweepOrders；
// T42 發票 sweep 用 .eq×2＋.order＋.limit 撈未開票訂單 → 回 uninvoicedOrders
// （並側錄 eq 過濾條件供斷言）。
function makeOrdersChain() {
  let usedIn = false;
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      lastOrdersFilters[col] = val;
      return chain;
    },
    in: () => {
      usedIn = true;
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown) => void) => {
      resolve({ data: usedIn ? sweepOrders : uninvoicedOrders, error: null });
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
    _filters: {} as Record<string, unknown>,
    _ors: [] as string[],
    select: (cols?: string) => {
      chain._select = cols;
      return chain;
    },
    eq: (col: string, val: unknown) => {
      chain._filters[col] = val;
      return chain;
    },
    lt: (col: string, val: unknown) => {
      chain._filters[`${col}__lt`] = val;
      return chain;
    },
    or: (filter: string) => {
      chain._ors.push(filter);
      return chain;
    },
    order: (col: string, opts?: unknown) => {
      chain._order = { col, opts };
      return chain;
    },
    limit: (n: unknown) => {
      chain._limit = n;
      return chain;
    },
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
        if (chain._filters.status === "paid") {
          // status='paid' 有兩支：漂移臂（orders.status='pending_payment'）
          // 與稽核臂（orders.status='cancelled'），以 embed 過濾值分流。
          if (chain._filters["orders.status"] === "cancelled") {
            auditQueryCapture = {
              select: chain._select,
              filters: { ...chain._filters },
            };
            resolve(
              auditQueryError
                ? { data: null, error: { message: auditQueryError } }
                : { data: auditCandidates, error: null },
            );
            return;
          }
          driftQueryCapture = {
            select: chain._select,
            ors: [...chain._ors],
            order: chain._order,
            filters: { ...chain._filters },
            limit: chain._limit,
          };
          resolve(
            driftQueryError
              ? { data: null, error: { message: driftQueryError } }
              : { data: driftCandidates, error: null },
          );
          return;
        }
        mainQueryCapture = { ors: [...chain._ors] };
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

// C-Eff2：route 的節流 sleep 走 setTimeout(400ms)；測試不需要真的等，改成
// 立即以 microtask 解析（保留 await 讓步的語意，但零真實延遲），省掉每輪
// 漂移／sweep 測試 ~數秒的真實掛鐘等待。
vi.stubGlobal(
  "setTimeout",
  ((fn: () => void) => {
    queueMicrotask(fn);
    return 0;
  }) as unknown as typeof setTimeout,
);

beforeEach(() => {
  candidates = [];
  driftCandidates = [];
  auditCandidates = [];
  recorded = [];
  casLossIds = new Set();
  casErrorIds = new Set();
  lastReconciledError = null;
  driftQueryCapture = undefined;
  mainQueryCapture = undefined;
  auditQueryCapture = undefined;
  driftQueryError = null;
  auditQueryError = null;
  failedNotifications = [];
  sweepOrders = [];
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
  uninvoicedOrders.length = 0;
  for (const key of Object.keys(lastOrdersFilters)) {
    delete lastOrdersFilters[key];
  }
  issueInvoiceForOrder.mockReset();
});

describe("候選查詢的 .or() 過濾字串格式", () => {
  it("主候選查詢的 last_reconciled_at ISO timestamp 值必須用雙引號包住（PostgREST 保留句點/逗號）", async () => {
    await GET(buildRequest("Bearer test-cron-secret"));

    // 專門斷言「主候選查詢」自己的 .or()（不是漂移臂後續 .or() 覆蓋的
    // 全域 lastOrFilter——那會讓主臂格式回歸靜默溜過，見 K6）。
    expect(mainQueryCapture).toBeDefined();
    const mainOr = mainQueryCapture!.ors.find((f) =>
      f.startsWith("last_reconciled_at"),
    );
    // 錯誤示範（曾造成 sandbox 驗證撈到錯的候選）：
    //   last_reconciled_at.lt.2026-07-06T14:39:32.580Z   ← 值裡的句點沒包住
    // 正確：值兩端要有雙引號。
    expect(mainOr).toMatch(/last_reconciled_at\.lt\."[^"]+"/);
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
      driftChecked: 0,
      driftPromoted: 0,
      driftTruncated: false,
      promotedOnClosedOrder: 0,
      paidOnCancelled: 0,
      mismatches: 0,
      failed: 0,
      unexpected: 0,
      notifyFailed: 0,
      sweepRetried: 0,
      sweepSent: 0,
      sweepStillFailing: 0,
      rateLimited: false,
      invoicesSwept: 0,
      invoicesIssued: 0,
      invoicesFailed: 0,
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

describe("T127② 漂移臂（webhook 側卡單：payment=paid／orders=pending_payment）", () => {
  it("漂移候選 → 以 'reconcile-drift' 呼叫 ensureOrderPaid、不打 ECPay、計 driftChecked/driftPromoted、warning 告警", async () => {
    driftCandidates = [{ id: "p1", order_id: "o1", merchant_trade_no: "M1" }];

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    // 財務事實已確立（payment=paid＝當初驗章＋金額核對通過），不需要也不
    // 應該再打 ECPay。
    expect(queryTradeInfo).not.toHaveBeenCalled();
    expect(ensureOrderPaid).toHaveBeenCalledWith(
      expect.anything(),
      "o1",
      "reconcile-drift",
    );
    expect(ensureNotificationSent).toHaveBeenCalledWith(
      expect.anything(),
      "o1",
    );
    expect(body.driftChecked).toBe(1);
    expect(body.driftPromoted).toBe(1);
    // 不污染主臂的計數。
    expect(body.checked).toBe(0);
    expect(body.promoted).toBe(0);
    // 漂移臂不再套主臂冷卻（K11）：不寫 last_reconciled_at（idempotent，推進
    // 成功即離開候選集，天然收斂；共用主臂冷卻反而會延後一天自癒）。
    expect(
      recorded.some(
        (r) => r.filters.id === "p1" && (r.values as any)?.last_reconciled_at,
      ),
    ).toBe(false);
    // 每一筆 driftPromoted 都代表 webhook settlePaid 半路失敗過：留 warning
    // 追蹤 webhook 可靠度（比照 promoted 慣例）。
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "reconcile: promoted webhook-side stuck order",
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("漂移候選查詢形狀：inner embed＋orders.status='pending_payment' 過濾、NULL-tolerant 年齡閘門（timestamp 雙引號）、NULLS FIRST 排序、限量 DRIFT_LIMIT", async () => {
    driftCandidates = [{ id: "p1", order_id: "o1", merchant_trade_no: "M1" }];

    await GET(buildRequest("Bearer test-cron-secret"));

    expect(driftQueryCapture).toBeDefined();
    // 漂移的定義有一半在 embed 上（orders.status='pending_payment'）：漏掉
    // inner embed 或漏掉這個 eq 會把「所有 paid payment」全撈進來當漂移單、
    // 對已取消／退款訂單狂發假 P0（K7）。
    expect(driftQueryCapture!.select).toContain("orders!inner(status)");
    expect(driftQueryCapture!.filters["orders.status"]).toBe("pending_payment");
    // 單一 .or()（K11 移除共用冷卻閘門後只剩年齡閘門）：NULL-tolerant（人工修
    // SQL 不寫 paid_at）、timestamp 帶雙引號（PostgREST 保留字元陷阱）。
    expect(driftQueryCapture!.ors).toHaveLength(1);
    expect(driftQueryCapture!.ors[0]).toMatch(
      /^paid_at\.is\.null,paid_at\.lt\."[^"]+"$/,
    );
    // NULLS FIRST 必須明示：Postgres ASC 預設 NULLS LAST，會把 paid_at IS
    // NULL 的人工列排到 DRIFT_LIMIT 之外（大面積漂移時被截掉、多等數天）。
    expect(driftQueryCapture!.order).toEqual({
      col: "paid_at",
      opts: { ascending: true, nullsFirst: true },
    });
    // 限量必須明示（否則 PostgREST 預設回上限筆數，截斷偵測也失準）。
    expect(driftQueryCapture!.limit).toBe(20);
  });

  it("ensureOrderPaid 拋例外 → unexpected +1、批次繼續（本臂 idempotent，不蓋冷卻章）", async () => {
    driftCandidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1" },
      { id: "p2", order_id: "o2", merchant_trade_no: "M2" },
    ];
    ensureOrderPaid.mockRejectedValueOnce(
      new Error("ensureOrderPaid failed: simulated"),
    );

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.driftChecked).toBe(2);
    expect(body.unexpected).toBe(1);
    // 第二筆不受影響。
    expect(body.driftPromoted).toBe(1);
    // K11：漂移臂不蓋 last_reconciled_at（隔日候選集仍含此單自動重試）。
    expect(
      recorded.some(
        (r) => r.filters.id === "p1" && (r.values as any)?.last_reconciled_at,
      ),
    ).toBe(false);
  });

  it("撞上取消競態（ensureOrderPaid 回 closed）→ 沿用 promotedOnClosedOrder＋error 告警、不計 driftPromoted", async () => {
    driftCandidates = [{ id: "p1", order_id: "o1", merchant_trade_no: "M1" }];
    ensureOrderPaid.mockResolvedValueOnce("closed");

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.driftPromoted).toBe(0);
    expect(body.promotedOnClosedOrder).toBe(1);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "reconcile: money received on closed order",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("候選查詢後才被別人推進（already-settled）→ 不計數、不告警", async () => {
    driftCandidates = [{ id: "p1", order_id: "o1", merchant_trade_no: "M1" }];
    ensureOrderPaid.mockResolvedValueOnce("already-settled");

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.driftChecked).toBe(1);
    expect(body.driftPromoted).toBe(0);
    expect(body.promotedOnClosedOrder).toBe(0);
    expect(sentryCaptureMessage).not.toHaveBeenCalledWith(
      "reconcile: promoted webhook-side stuck order",
      expect.anything(),
    );
  });

  it("通知投遞失敗（ensureNotificationSent 回 false）→ notifyFailed 計數", async () => {
    driftCandidates = [{ id: "p1", order_id: "o1", merchant_trade_no: "M1" }];
    ensureNotificationSent.mockResolvedValueOnce(false);

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.driftPromoted).toBe(1);
    expect(body.notifyFailed).toBe(1);
  });

  it("主迴圈 rate limited 中止後，漂移臂仍照常執行（不打 ECPay、不受限速影響）", async () => {
    candidates = [
      { id: "p1", order_id: "o1", merchant_trade_no: "M1", amount: 25000 },
    ];
    queryTradeInfo.mockRejectedValueOnce(new RateLimitError("403"));
    driftCandidates = [{ id: "p9", order_id: "o9", merchant_trade_no: "M9" }];

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.rateLimited).toBe(true);
    expect(body.driftChecked).toBe(1);
    expect(body.driftPromoted).toBe(1);
  });

  it("#4 推進成功後掃該訂單其餘 pending payment → failed（消滅永久 zombie）", async () => {
    driftCandidates = [{ id: "p1", order_id: "o1", merchant_trade_no: "M1" }];
    ensureOrderPaid.mockResolvedValueOnce("promoted");

    await GET(buildRequest("Bearer test-cron-secret"));

    // sweepSiblingPendingPayments：UPDATE payment SET status='failed'
    // WHERE order_id='o1' AND status='pending'
    expect(
      recorded.some(
        (r) =>
          (r.values as any)?.status === "failed" &&
          r.filters.order_id === "o1" &&
          r.filters.status === "pending",
      ),
    ).toBe(true);
  });

  it("#4 already-settled 也掃 sibling pending（訂單已 paid，殘留 pending 須清）", async () => {
    driftCandidates = [{ id: "p1", order_id: "o1", merchant_trade_no: "M1" }];
    ensureOrderPaid.mockResolvedValueOnce("already-settled");

    await GET(buildRequest("Bearer test-cron-secret"));

    expect(
      recorded.some(
        (r) =>
          (r.values as any)?.status === "failed" &&
          r.filters.order_id === "o1" &&
          r.filters.status === "pending",
      ),
    ).toBe(true);
  });

  it("#4 closed 不掃 sibling（錢收在已關閉訂單，走人工裁決不動 payment）", async () => {
    driftCandidates = [{ id: "p1", order_id: "o1", merchant_trade_no: "M1" }];
    ensureOrderPaid.mockResolvedValueOnce("closed");

    await GET(buildRequest("Bearer test-cron-secret"));

    expect(
      recorded.some(
        (r) =>
          (r.values as any)?.status === "failed" &&
          r.filters.order_id === "o1",
      ),
    ).toBe(false);
  });

  it("#10 撈到滿批 DRIFT_LIMIT → driftTruncated=true＋warning 告警", async () => {
    driftCandidates = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      order_id: `o${i}`,
      merchant_trade_no: `M${i}`,
    }));

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.driftTruncated).toBe(true);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "reconcile: drift backlog may exceed limit",
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("Conv1 漂移候選查詢 {error} → 告警＋不 throw、整支 cron 回 500（fail-visible）", async () => {
    driftQueryError = "connection timeout";

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    // 不 throw（回 500 而非例外冒泡）、其餘 sweep 仍照跑。
    expect(res.status).toBe(500);
    expect(body.driftChecked).toBe(0);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "reconcile: drifted-order 候選查詢失敗",
      expect.objectContaining({ level: "error" }),
    );
  });
});

describe("#3 recurring 稽核臂（payment=paid ∧ orders=cancelled）", () => {
  it("查詢形狀：inner embed＋orders.status='cancelled' 過濾", async () => {
    await GET(buildRequest("Bearer test-cron-secret"));

    expect(auditQueryCapture).toBeDefined();
    expect(auditQueryCapture!.select).toContain("orders!inner(status)");
    expect(auditQueryCapture!.filters.status).toBe("paid");
    expect(auditQueryCapture!.filters["orders.status"]).toBe("cancelled");
  });

  it("撈到 paid-on-cancelled 漂移列 → paidOnCancelled 計數＋error 告警（durable 兜底）", async () => {
    auditCandidates = [{ id: "p1", order_id: "o1", merchant_trade_no: "M1" }];

    const res = await GET(buildRequest("Bearer test-cron-secret"));
    const body = await res.json();

    expect(body.paidOnCancelled).toBe(1);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "reconcile: paid payment on cancelled order",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("稽核查詢 {error} → 告警＋整支 cron 回 500（fail-visible）", async () => {
    auditQueryError = "connection timeout";

    const res = await GET(buildRequest("Bearer test-cron-secret"));

    expect(res.status).toBe(500);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      "reconcile: paid-on-cancelled 稽核查詢失敗",
      expect.objectContaining({ level: "error" }),
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
