import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ensureOrderPaid,
  ensureNotificationSent,
} from "@/lib/order/ensure-paid";
import { queryTradeInfo, RateLimitError } from "@/lib/ecpay/query-trade-info";
import { requireCronAuth } from "@/lib/cron/require-cron-auth";
import { sendOnce } from "@/lib/notification/send-once";
import { NOTIFICATION_SENDERS } from "@/lib/notification/senders";
import type { OrderStatus } from "@/lib/order/order-status";

const CANDIDATE_LIMIT = 30;
const MIN_AGE_MS = 10 * 60 * 1000;
// 冷卻必須明顯短於 cron 週期（每日一次）：last_reconciled_at 的蓋章時間晚於
// cron 起跑（前面候選每筆 400ms 節流＋ECPay 往返），若冷卻＝24h，隔日 cron 的
// cutoff（now−24h）會差幾秒到幾分鐘而撈不到同一筆，「隔日重試」實際變隔兩日。
// T107 之後這個冷卻從「告警去重」升級為「失敗自癒的重試節奏」，20h 用來吸收
// cron jitter＋整批處理時間。
const RECONCILE_COOLDOWN_MS = 20 * 60 * 60 * 1000;
const THROTTLE_MS = 400;
const SWEEP_LIMIT = 20;

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

// T88 過渡版兜底：每天掃 notification.status='failed' 補寄。ECPay webhook
// 重送（快路徑）額度有限且可能被各種情況提前終止；有這個 sweep 在，「寄信
// 失敗」的最壞情況從「永久遺失」降為「延遲至下一個 cron 週期」。重試頻率
// 天然被 cron 排程（每日一次）限制，故不需要嘗試次數上限——永久性失敗
//（客人 email 打錯等）會每天重試失敗＋告警一次，連續多日同一筆告警＝該
// 人工介入（ops-runbook）；失敗分類＋次數上限的完整版需加欄位，登記為
// 獨立技術債任務。
async function sweepFailedNotifications(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  summary: Summary,
) {
  const { data: failedRows, error } = await serviceRole
    .from("notification")
    .select("id, order_id, type")
    .eq("status", "failed")
    .order("created_at", { ascending: true })
    .limit(SWEEP_LIMIT);

  if (error) {
    console.error("[ecpay-reconcile] failed-notification 查詢失敗", error);
    Sentry.captureMessage("reconcile: notification sweep query failed", {
      level: "error",
      extra: { error: error.message },
    });
    return;
  }
  if (!failedRows || failedRows.length === 0) return;

  // 批次撈訂單狀態做適寄判斷（不依賴 FK embed，兩段查詢即可）。
  const orderIds = [...new Set(failedRows.map((r) => r.order_id))];
  const { data: orders, error: ordersError } = await serviceRole
    .from("orders")
    .select("id, status")
    .in("id", orderIds);

  if (ordersError) {
    console.error("[ecpay-reconcile] sweep 訂單狀態查詢失敗", ordersError);
    Sentry.captureMessage("reconcile: sweep order-status query failed", {
      level: "error",
      extra: { error: ordersError.message },
    });
    return;
  }
  const statusById = new Map((orders ?? []).map((o) => [o.id, o.status]));

  for (const row of failedRows) {
    const sender = NOTIFICATION_SENDERS[row.type];
    const orderStatus = statusById.get(row.order_id);
    if (
      !sender ||
      !orderStatus ||
      !sender.eligibleStatuses.includes(orderStatus as OrderStatus)
    ) {
      // 未登記的通知類型／訂單已取消退款／查無訂單：不重寄。這類 row 會
      // 一直留在 failed 被每天撈到又跳過，屬可接受的低頻噪音；真要清理走
      // 人工（ops-runbook）。
      continue;
    }

    summary.sweepRetried += 1;
    // sendOnce 走 conflict → failed reclaim → attemptSend，天然去重且與
    // webhook 端的並發重試互斥，這裡不需要額外鎖。
    const ok = await sendOnce(serviceRole, {
      orderId: row.order_id,
      type: row.type,
      send: () => sender.send(row.order_id),
    });
    if (ok) {
      summary.sweepSent += 1;
    } else {
      summary.sweepStillFailing += 1;
      // 每日一筆的「還在失敗」訊號：連續多日出現同一 orderId+type＝多半是
      // 永久性失敗（email 打錯、網域限制），該人工介入。
      Sentry.captureMessage("reconcile: notification still failing", {
        level: "warning",
        extra: { orderId: row.order_id, type: row.type },
      });
    }
    // 節流：對 Resend 的呼叫比照主迴圈對 ECPay 的禮貌。
    await sleep(THROTTLE_MS);
  }
}

type Summary = {
  checked: number;
  promoted: number;
  mismatches: number;
  failed: number;
  unexpected: number;
  // 通知信投遞失敗獨立計數，不塞 unexpected——unexpected 已承載查詢例外／
  // 金額異常等資料面訊號，混裝會讓日報無法分辨「資料異常」與「郵件故障」
  //（T88 review）。
  notifyFailed: number;
  // failed-notification sweep（T88 過渡版兜底）的成果統計。
  sweepRetried: number;
  sweepSent: number;
  sweepStillFailing: number;
  rateLimited: boolean;
};

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
    notifyFailed: 0,
    sweepRetried: 0,
    sweepSent: 0,
    sweepStillFailing: 0,
    rateLimited: false,
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
          // ① 先推進訂單、payment 翻 paid 留到最後（T107／F-014）：候選查詢
          // 以 payment.status='pending' 為鍵，若先翻 payment 再推進訂單，推進
          // 段失敗時候選鍵已被消滅，隔日 cron 永遠選不到這筆——客人已付款、
          // 訂單永久卡 pending_payment、確認信未寄，安全網自身留盲點。改成
          // 推進失敗就跳過後續（payment 留 pending），隔日 24h 冷卻後自動重試。
          // ensureOrderPaid 冪等（orders 條件式 UPDATE CAS），webhook 已推進
          // 時安全 no-op；throw（狀態查詢 DB 暫時錯誤）不可中止整批——記錄後
          // 繼續下一筆（T88 review）。
          let orderPromotionOk = true;
          try {
            await ensureOrderPaid(serviceRole, payment.order_id, "reconcile");
          } catch (e) {
            orderPromotionOk = false;
            summary.unexpected += 1;
            Sentry.captureException(e, {
              extra: {
                orderId: payment.order_id,
                merchantTradeNo: payment.merchant_trade_no,
              },
            });
          }

          if (orderPromotionOk) {
            // ② CAS 把 payment 翻 paid。.select().maybeSingle() 取得是否真的
            // 搶到這次 CAS：webhook 可能在 candidate 查詢之後、這個 UPDATE 之
            // 前就先推進成功，此時 0 rows affected 但 Supabase 不會回傳 error
            // ——若不檢查就會把「webhook 其實正常運作」誤報成「對帳搶救了卡住
            // 的訂單」，污染 T88 要追蹤的 webhook 可靠度訊號。
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
              // 訂單已推進（①成功）、payment 留 pending：候選鍵保留，隔日
              // 重撈時①冪等 no-op、這裡的 CAS 重試補翻。短暫的「orders=paid
              // 但 payment=pending」漂移屬自癒中，勿人工介入（ops-runbook §1）。
              // 不擋③——訂單已 paid，信該寄。
              summary.unexpected += 1;
              Sentry.captureException(new Error(updateError.message), {
                extra: {
                  orderId: payment.order_id,
                  merchantTradeNo: payment.merchant_trade_no,
                },
              });
            } else if (promotedRow) {
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

            // ③ 補寄通知。冪等，且不 gate payment 翻 paid：payment.status 是
            // 財務記錄（錢已確認收到），不拿它當通知重試旗標——通知失敗由
            // 下方 failed-notification sweep 每天補救，webhook 端的 ECPay
            // 重送（若還有回呼）也走 reclaim 補寄。②的 updateError／CAS 輸給
            // webhook 都不影響這裡照跑。throw 同①：記錄後繼續下一筆。
            try {
              const notified = await ensureNotificationSent(
                serviceRole,
                payment.order_id,
              );
              if (!notified) {
                summary.notifyFailed += 1;
                Sentry.captureMessage(
                  "reconcile: notification delivery failed",
                  {
                    level: "warning",
                    extra: {
                      orderId: payment.order_id,
                      merchantTradeNo: payment.merchant_trade_no,
                    },
                  },
                );
              }
            } catch (e) {
              summary.unexpected += 1;
              Sentry.captureException(e, {
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

    await sweepFailedNotifications(serviceRole, summary);

    return Response.json(summary);
  } catch (e) {
    console.error("[ecpay-reconcile] unhandled error", e);
    Sentry.captureException(e);
    return Response.json(summary, { status: 500 });
  }
}
