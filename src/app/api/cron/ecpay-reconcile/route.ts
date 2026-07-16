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
import { sendOnce } from "@/lib/notification/send-once";
import { NOTIFICATION_SENDERS } from "@/lib/notification/senders";
import type { OrderStatus } from "@/lib/order/order-status";

const CANDIDATE_LIMIT = 30;
const MIN_AGE_MS = 10 * 60 * 1000;
// 冷卻必須明顯短於 cron 週期（每日一次）：last_reconciled_at 的蓋章時間晚於
// cron 起跑（前面候選每筆 400ms 節流＋ECPay 往返），若冷卻＝24h，隔日 cron 的
// cutoff（now−24h）會差幾秒到幾分鐘而撈不到同一筆，「隔日重試」實際變隔兩日。
// T107 之後這個冷卻從「告警去重」升級為「失敗自癒的重試節奏」，20h 用來吸收
// cron jitter＋整批處理時間。注意：此值與「每日一次」的排程頻率耦合——改排程
// （T126 小時級）必須連動改這裡（規則與連動清單見 tasks.csv T126 說明欄），
// 兩者相距僅一個檔案內常數與外部設定，不另加程式防呆。
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

  // 跟其他 Supabase 呼叫一樣必須檢查 { error }：漏檢查的話，這筆的對帳冷卻
  // 紀錄（RECONCILE_COOLDOWN_MS）悄悄沒寫入，隔天同一筆又會被撈出來重新告警。
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
  // 錢確認收到，但訂單處於 cancelled／refunded 等已關閉狀態（ensureOrderPaid
  // 回報 closed）——與 promoted（健康搶救）分流，這是「錢收在已關閉訂單上」
  // 的獨立訊號，須走人工裁決：退款或恢復訂單（ops-runbook §6.1）。
  promotedOnClosedOrder: number;
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
    promotedOnClosedOrder: 0,
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
  };

  // 單筆候選「非預期失敗」的共用出口：計數＋Sentry exception。已知取捨：同一
  // 筆候選一輪內可能計到 2 次 unexpected（例如②的 CAS {error} 與③的 throw 各
  // 記一次）——兩個獨立故障本來就是兩個訊號，去重需額外狀態、弊大於利，維持
  // 雙計（PR #67 review 拍板）。
  const recordUnexpected = (
    e: unknown,
    payment: { order_id: string; merchant_trade_no: string },
  ) => {
    summary.unexpected += 1;
    Sentry.captureException(e, {
      extra: {
        orderId: payment.order_id,
        merchantTradeNo: payment.merchant_trade_no,
      },
    });
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
        recordUnexpected(e, payment);
        await markReconciled(serviceRole, payment.id);
        // 節流不能因為這筆失敗就跳過——連續幾筆壞資料若零間隔連續打
        // ECPay，正是節流機制原本要防止的情況。
        await sleep(THROTTLE_MS);
        continue;
      }

      // 不論後續分支結果如何，先記錄查過的時間，避免同一筆在冷卻期
      // （RECONCILE_COOLDOWN_MS）內被重複告警。
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
        } else if (
          // 金額正數防呆：0 === 0 不得視為吻合——TradeAmt 與 payment.amount 同
          // 時為 0（建單 bug／異常回應被解析成 0）時，絕不可據此自動改狀態，
          // 落到下方 mismatch 分支告警交人工。notify 路徑（webhook 端）沒有這
          // 道對稱防呆，待 T127 順手補上。
          Number(result.tradeAmt) > 0 &&
          Number(result.tradeAmt) === Number(payment.amount)
        ) {
          // 單一 try/catch 包住 ①②③：①的 throw 自然跳過②③（候選鍵保留、
          // 冷卻期滿隔日自動重試＝F-014 修正核心）；②走 {error} 解構、不
          // throw；③的 throw 落到同一個 catch。任何單筆失敗都不可中止整批
          // （外層 catch 會直接 500，其餘候選當天全數不對帳）——記錄後繼續
          // 下一筆（T88 review）。
          try {
            // ① 先推進訂單、payment 翻 paid 留到最後（T107／F-014）：候選查詢
            // 以 payment.status='pending' 為鍵，若先翻 payment 再推進訂單，推進
            // 段失敗時候選鍵已被消滅，隔日 cron 永遠選不到這筆——客人已付款、
            // 訂單永久卡 pending_payment、確認信未寄，安全網自身留盲點。
            // ensureOrderPaid 冪等（CAS 走 transition_order_status RPC，狀態
            // 推進＋稽核 log 同一交易，T110），webhook 已推進時安全 no-op；
            // log 寫入失敗會 rollback 推進並 throw（落到本 catch，候選鍵保留
            // 隔日重試）。promoted 計數掛在①的回傳（見下方分類），計在搶救
            // 真正發生那一輪；隔日補翻 payment 的那一輪①回 already-settled、
            // 不再重複計。
            const orderResult = await ensureOrderPaid(
              serviceRole,
              payment.order_id,
              "reconcile",
            );

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
              // 但 payment=pending」漂移屬自癒中，勿人工介入（ops-runbook §1）
              // ——嚴重度比照「promoted stuck payment」用 warning，不進
              // exception。不擋③——訂單已 paid，信該寄。
              summary.unexpected += 1;
              Sentry.captureMessage("reconcile: payment CAS update failed", {
                level: "warning",
                extra: {
                  orderId: payment.order_id,
                  merchantTradeNo: payment.merchant_trade_no,
                  error: updateError.message,
                },
              });
            }

            // 分類掛在①的 orderResult 上、不論②結果——②只回答「payment 這
            // 一輪有沒有翻成」，回答不了「這筆搶救的性質」：分類若 gate 在
            // ② CAS 搶贏上，② CAS miss／{error} 時「錢收在已關閉訂單」的
            // P0 告警整個不發（漏報）、promoted 也計錯天。
            if (orderResult === "closed") {
              // ①重查已確認訂單處於 cancelled／refunded 等關閉狀態，但綠界
              // 確認錢已收到——payment 照翻 paid（財務事實：gateway_trade_no／
              // raw_callback 是日後退款的唯一依據，必須落地），但這不是
              // 「搶救成功」：不計 promoted、走獨立計數＋error 級告警，與
              // 健康搶救訊號分流。不論②結果都要發：② CAS miss＝payment 被
              // 別人翻的，錢一樣收在已關閉訂單上；② {error}＝payment 留
              // pending、隔日再入選再告警，對 P0 錢務問題是催辦不是噪音。
              // 單次告警漏看的殘餘風險由人工裁決程序承接（ops-runbook §6.1）。
              summary.promotedOnClosedOrder += 1;
              Sentry.captureMessage(
                "reconcile: money received on closed order",
                {
                  level: "error",
                  extra: {
                    orderId: payment.order_id,
                    merchantTradeNo: payment.merchant_trade_no,
                  },
                },
              );
            } else if (orderResult === "promoted") {
              // 對帳路徑真的修正了訂單＝webhook 那條路徑當初失敗過；即使結果
              // 正確，也留一筆告警，方便日後追蹤 webhook 可靠度（呼應 T88）。
              // 不論②結果：搶救＝①把訂單推進成 paid，計在發生的這一輪；
              // ②失敗只代表 payment 隔日補翻，屆時①回 already-settled 不重計。
              summary.promoted += 1;
              Sentry.captureMessage("reconcile: promoted stuck payment", {
                level: "warning",
                extra: {
                  orderId: payment.order_id,
                  merchantTradeNo: payment.merchant_trade_no,
                },
              });
            } else if (orderResult === "indeterminate" && promotedRow) {
              // ①無法確認訂單現況（重查失敗／查無此單，①內已發 P0 告警）：
              // 對計數維持保守語意——只有這一輪確實翻了 payment（② CAS 搶贏）
              // 才計 promoted，不憑「查不到」推論搶救性質。
              summary.promoted += 1;
              Sentry.captureMessage("reconcile: promoted stuck payment", {
                level: "warning",
                extra: {
                  orderId: payment.order_id,
                  merchantTradeNo: payment.merchant_trade_no,
                },
              });
            }
            // orderResult === "already-settled"：不計數——搶救（若曾發生）已
            // 計在它真正發生的那一輪；②搶贏只是 payment 補翻，不是新事件。

            // ③ 補寄通知。冪等，且不 gate payment 翻 paid：payment.status 是
            // 財務記錄（錢已確認收到），不拿它當通知重試旗標——通知失敗由
            // 下方 failed-notification sweep 每天補救，webhook 端的 ECPay
            // 重送（若還有回呼）也走 reclaim 補寄。②的 updateError／CAS 輸給
            // webhook 都不影響這裡照跑；訂單已關閉時它內部自行判斷不寄。
            const notified = await ensureNotificationSent(
              serviceRole,
              payment.order_id,
            );
            if (!notified) {
              // 已知取捨：併發雙跑（手動觸發撞上排程）時 sendOnce 的輸方會讓
              // 這個計數虛報——「false＝未確認送達」是 T88 契約，不為降噪改
              // 弱；實際投遞由 sendOnce 天然去重、sweep 自癒。
              summary.notifyFailed += 1;
              Sentry.captureMessage("reconcile: notification delivery failed", {
                level: "warning",
                extra: {
                  orderId: payment.order_id,
                  merchantTradeNo: payment.merchant_trade_no,
                },
              });
            }
          } catch (e) {
            recordUnexpected(e, payment);
          }
        } else {
          // 金額不符：只告警，絕不自動改狀態——對帳的自動修正權限收斂到
          // 「明確吻合」才能動用，呼應「絕不信任前端價格」的紅線精神。
          // payment 留 pending＝每日重新入選、每日重告警：這是 P0 錢務問題
          // 的催辦機制（intentional），人工處理完（ops-runbook §2）告警自止。
          // 能走到這裡且兩值相等＝同為 0 被上方正數防呆擋下——那不是「金額
          // 不符」而是「零元 payment」異常（建單 bug／回應被解析成 0），
          // 訊息分開，告警才不會把人導去查根本不存在的差額。
          summary.mismatches += 1;
          Sentry.captureMessage(
            Number(result.tradeAmt) === Number(payment.amount)
              ? "reconcile: zero-amount payment anomaly"
              : "reconcile: amount mismatch",
            {
              level: "error",
              extra: {
                orderId: payment.order_id,
                merchantTradeNo: payment.merchant_trade_no,
                tradeAmt: result.tradeAmt,
                paymentAmount: payment.amount,
              },
            },
          );
        }
      } else if (result.tradeStatus === "10200095") {
        // ECPay 官方文件記載的付款失敗碼：只告警，不把 payment.status 改成
        // failed——讓客人能重新付款屬 T66/T74 待付款生命週期整批的範圍。
        // payment 留 pending＝每日重告警屬 intentional 催辦，同 mismatch 分支。
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
