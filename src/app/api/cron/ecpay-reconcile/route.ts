import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ensureOrderPaid,
  ensureNotificationSent,
} from "@/lib/order/ensure-paid";
import { issueInvoiceForOrder } from "@/lib/order/issue-invoice";
import { queryTradeInfo, RateLimitError } from "@/lib/ecpay/query-trade-info";
import { requireCronAuth } from "@/lib/cron/require-cron-auth";

const CANDIDATE_LIMIT = 30;
const MIN_AGE_MS = 10 * 60 * 1000;
const RECONCILE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const THROTTLE_MS = 400;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function markReconciled(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  paymentId: string,
) {
  const { error } = await serviceRole
    .from("payment")
    .update({ last_reconciled_at: new Date().toISOString() })
    .eq("id", paymentId);

  // 跟其他 Supabase 呼叫一樣必須檢查 { error }：漏檢查的話，這筆的
  // 24 小時對帳冷卻紀錄悄悄沒寫入，隔天同一筆又會被撈出來重新告警。
  if (error) {
    console.error("[ecpay-reconcile] last_reconciled_at update failed", error);
    Sentry.captureMessage("reconcile: last_reconciled_at update failed", {
      level: "error",
      extra: { paymentId, error: error.message },
    });
  }
}

type Summary = {
  checked: number;
  promoted: number;
  mismatches: number;
  failed: number;
  unexpected: number;
  rateLimited: boolean;
  invoicesSwept: number;
  invoicesIssued: number;
  invoicesFailed: number;
};

const INVOICE_SWEEP_LIMIT = 20;

// T42：「已付款未開票」每日 sweep（藍圖 07-invoice.md §6 明訂的核對項）——
// webhook 那次開立失敗（ECPay 暫時性故障、after() 執行環境被提早回收等）的
// 自動補開防線；issueInvoiceForOrder 冪等（issued 短路＋GetIssue 判別），
// 與 webhook／後台補開共用同一支，重跑安全。
async function sweepUninvoicedPaidOrders(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  summary: Summary,
) {
  const { data: uninvoiced, error } = await serviceRole
    .from("orders")
    .select("id")
    .eq("status", "paid")
    .eq("invoice_status", "none")
    .order("created_at", { ascending: true })
    .limit(INVOICE_SWEEP_LIMIT);

  if (error) {
    Sentry.captureMessage("reconcile: 未開票訂單查詢失敗", {
      level: "error",
      extra: { error: error.message },
    });
    return;
  }

  for (const order of uninvoiced ?? []) {
    summary.invoicesSwept += 1;
    const result = await issueInvoiceForOrder(serviceRole, order.id);
    if (result.ok) {
      summary.invoicesIssued += 1;
      // 走到 sweep 才開成＝webhook 那次失敗過，留告警追蹤（比照 promoted 慣例）
      Sentry.captureMessage("reconcile: 補開發票成功（webhook 當次曾失敗）", {
        level: "warning",
        extra: { orderId: order.id, invoiceNo: result.invoiceNo },
      });
    } else {
      summary.invoicesFailed += 1;
      Sentry.captureMessage("reconcile: 補開發票仍失敗，需人工處理", {
        level: "error",
        extra: { orderId: order.id, error: result.error },
      });
    }
    await sleep(THROTTLE_MS);
  }
}

// T89：ECPay 主動對帳。webhook 是即時路徑，這支 cron 是每日一次的最終防線——
// 只做「pending→paid 的主動修正＋告警」，範圍刻意不含逾期取消（見 T66）。
export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const summary: Summary = {
    checked: 0,
    promoted: 0,
    mismatches: 0,
    failed: 0,
    unexpected: 0,
    rateLimited: false,
    invoicesSwept: 0,
    invoicesIssued: 0,
    invoicesFailed: 0,
  };

  try {
    const serviceRole = createServiceRoleClient();
    const now = Date.now();
    const maxCreatedAt = new Date(now - MIN_AGE_MS).toISOString();
    const reconcileCutoff = new Date(now - RECONCILE_COOLDOWN_MS).toISOString();

    // PostgREST 的 .or() 語法用句點分隔「欄位.運算子.值」，值裡若含句點／逗號
    // 等保留字元（ISO timestamp 的毫秒部分就有句點）必須用雙引號包住，否則
    // 解析會跑掉，導致撈到的候選跟預期不符（曾在 sandbox 端到端驗證中實測到
    // 這個問題：候選數量對不上、且漏掉了明確符合條件的資料）。
    const { data: candidates, error } = await serviceRole
      .from("payment")
      .select("id, order_id, merchant_trade_no, amount")
      .eq("status", "pending")
      .lt("created_at", maxCreatedAt)
      .or(
        `last_reconciled_at.is.null,last_reconciled_at.lt."${reconcileCutoff}"`,
      )
      .order("created_at", { ascending: true })
      .limit(CANDIDATE_LIMIT);

    if (error) throw new Error(`候選查詢失敗: ${error.message}`);

    for (const payment of candidates ?? []) {
      summary.checked += 1;

      let result;
      try {
        result = await queryTradeInfo(payment.merchant_trade_no);
      } catch (e) {
        if (e instanceof RateLimitError) {
          summary.rateLimited = true;
          Sentry.captureMessage("reconcile: rate limited, aborting batch", {
            level: "warning",
            extra: {
              merchantTradeNo: payment.merchant_trade_no,
              error: e.message,
            },
          });
          break;
        }
        // 單筆查詢失敗（含 CheckMacValue 驗證失敗）：記錄並繼續下一筆，
        // 不讓一筆髒資料拖垮整批；last_reconciled_at 仍要寫，避免明天重查同一筆卡死。
        summary.unexpected += 1;
        Sentry.captureException(e, {
          extra: { merchantTradeNo: payment.merchant_trade_no },
        });
        await markReconciled(serviceRole, payment.id);
        // 節流不能因為這筆失敗就跳過——連續幾筆壞資料若零間隔連續打
        // ECPay，正是節流機制原本要防止的情況。
        await sleep(THROTTLE_MS);
        continue;
      }

      // 不論後續分支結果如何，先記錄查過的時間，避免同一筆 24 小時內被重複告警。
      await markReconciled(serviceRole, payment.id);

      if (result.tradeStatus === "1") {
        // Number.isFinite 防呆：TradeAmt 格式異常時絕不可誤判為金額相符
        // （沿用 notify/route.ts 既有寫法）。
        if (!Number.isFinite(result.tradeAmt)) {
          summary.unexpected += 1;
          Sentry.captureMessage("reconcile: TradeAmt 格式異常", {
            level: "error",
            extra: {
              merchantTradeNo: payment.merchant_trade_no,
              tradeAmt: result.raw.TradeAmt,
            },
          });
        } else if (Number(result.tradeAmt) === Number(payment.amount)) {
          // .select().maybeSingle() 取得是否真的搶到這次 CAS：webhook 可能在
          // candidate 查詢之後、這個 UPDATE 之前就先推進成功，此時 0 rows
          // affected 但 Supabase 不會回傳 error——若不檢查就會把「webhook 其實
          // 正常運作」誤報成「對帳搶救了卡住的訂單」，污染 T88 要追蹤的
          // webhook 可靠度訊號。
          const { data: promotedRow, error: updateError } = await serviceRole
            .from("payment")
            .update({
              status: "paid",
              gateway_trade_no: result.tradeNo,
              paid_at: new Date().toISOString(),
              raw_callback: result.raw,
            })
            .eq("id", payment.id)
            .eq("status", "pending") // CAS guard：防與 webhook 競態
            .select("id")
            .maybeSingle();

          if (updateError) {
            summary.unexpected += 1;
            Sentry.captureException(new Error(updateError.message), {
              extra: { merchantTradeNo: payment.merchant_trade_no },
            });
          } else {
            // ensureOrderPaid/ensureNotificationSent 各自冪等，即使這次沒搶到
            // CAS（webhook 已經處理過）呼叫也安全，用來補做可能半路失敗的通知。
            await ensureOrderPaid(serviceRole, payment.order_id, "reconcile");
            await ensureNotificationSent(serviceRole, payment.order_id);

            if (promotedRow) {
              summary.promoted += 1;
              // 對帳路徑真的修正了訂單＝webhook 那條路徑當初失敗過；即使結果
              // 正確，也留一筆告警，方便日後追蹤 webhook 可靠度（呼應 T88）。
              Sentry.captureMessage("reconcile: promoted stuck payment", {
                level: "warning",
                extra: {
                  orderId: payment.order_id,
                  merchantTradeNo: payment.merchant_trade_no,
                },
              });
            }
          }
        } else {
          // 金額不符：只告警，絕不自動改狀態——對帳的自動修正權限收斂到
          // 「明確吻合」才能動用，呼應「絕不信任前端價格」的紅線精神。
          summary.mismatches += 1;
          Sentry.captureMessage("reconcile: amount mismatch", {
            level: "error",
            extra: {
              orderId: payment.order_id,
              merchantTradeNo: payment.merchant_trade_no,
              tradeAmt: result.tradeAmt,
              paymentAmount: payment.amount,
            },
          });
        }
      } else if (result.tradeStatus === "10200095") {
        // ECPay 官方文件記載的付款失敗碼：只告警，不把 payment.status 改成
        // failed——讓客人能重新付款屬 T66/T74 待付款生命週期整批的範圍。
        summary.failed += 1;
        Sentry.captureMessage("reconcile: ECPay reports payment failed", {
          level: "warning",
          extra: {
            orderId: payment.order_id,
            merchantTradeNo: payment.merchant_trade_no,
          },
        });
      } else if (result.tradeStatus === "0") {
        // 真的還沒付款：不動作，留給未來 T66。
      } else {
        // 非上述任何已知值（含缺欄位）：非預期回應，只告警。
        summary.unexpected += 1;
        Sentry.captureMessage("reconcile: unexpected TradeStatus", {
          level: "warning",
          extra: {
            merchantTradeNo: payment.merchant_trade_no,
            raw: result.raw,
          },
        });
      }

      await sleep(THROTTLE_MS);
    }

    // T42：付款對帳跑完後接著補開發票——即使上面被 rate limit 中斷也照跑
    // （發票 API 是獨立網域與額度，不受金流查詢限速影響）
    await sweepUninvoicedPaidOrders(serviceRole, summary);

    return Response.json(summary);
  } catch (e) {
    console.error("[ecpay-reconcile] unhandled error", e);
    Sentry.captureException(e);
    return Response.json(summary, { status: 500 });
  }
}
