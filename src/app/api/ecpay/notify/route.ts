import "server-only";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCheckMacValue } from "@/lib/ecpay/check-mac-value";
import { serverEnv } from "@/lib/env.server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PG_UNIQUE_VIOLATION } from "@/lib/supabase/postgres-error-codes";
import {
  ensureOrderPaid,
  ensureNotificationSent,
  ensureInvoiceIssued,
} from "@/lib/order/ensure-paid";
import { findPaidPayment } from "@/lib/order/find-paid-payment";
import { validateSettleAmount } from "@/lib/ecpay/validate-settle-amount";
import { merchantTradeNoToOrderNo } from "@/lib/ecpay/merchant-trade-no";

const OK = () =>
  new Response("1|OK", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
const ERR = (msg: string) =>
  new Response(`0|${msg}`, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });

// 付款成立的結算 chokepoint：推進訂單＋補寄通知＋依結果回應，四個入口共用
//（T88 review 收斂——原本四份複本，正是 T67 記錄過的散落複本失同步模式）。
// 通知寄送失敗回 0|ERR 讓 ECPay 重送、重送走 sendOnce 的 reclaim 補寄；
// 訂單推進在回應之前已完成且各自冪等，重送重入安全。
async function settlePaid(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
): Promise<Response> {
  await ensureOrderPaid(serviceRole, orderId, "webhook");
  // T42：發票開立移出回應路徑（after()）——外部 ECPay Issue API 的延遲不可
  // 佔用 ReturnURL 的 10 秒預算（藍圖：發票不阻塞金流）。ensureInvoiceIssued
  // 冪等且絕不 throw，即使下方通知失敗回 0|ERR 觸發 ECPay 重送，重入也安全；
  // 開立失敗由每日 reconcile cron 的未開票 sweep 兜底。
  after(() => ensureInvoiceIssued(serviceRole, orderId));
  const notified = await ensureNotificationSent(serviceRole, orderId);
  if (!notified) return ERR("notification delivery failed");
  return OK();
}

export async function POST(request: Request) {
  // hoist 到 try 外：T110 後 ensureOrderPaid 的 log 寫入失敗會 rollback 並
  // throw 落到最外層 catch——告警必須帶得出是哪一筆交易，否則 Sentry 只剩
  // 無法對應訂單的 generic error（舊版 log-insert 專屬告警帶有 orderId）。
  let merchantTradeNo: string | undefined;
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of formData.entries()) params[k] = String(v);

    // CheckMacValue 驗章（安全關卡）
    if (
      !verifyCheckMacValue(
        params,
        serverEnv.ECPAY_HASH_KEY,
        serverEnv.ECPAY_HASH_IV,
      )
    ) {
      return ERR("CheckMacValue Error");
    }

    merchantTradeNo = params.MerchantTradeNo;
    if (!merchantTradeNo) return ERR("MerchantTradeNo missing");

    const serviceRole = createServiceRoleClient();

    // 查訂單：MerchantTradeNo = order_no 去 hyphen + 2 字元後綴（T53），
    // 先查 payment 表以取得 order_id（不再依賴字串解析）。
    // 檢查 { error }：暫時性 DB 故障不會 throw、只回 { error }；漏檢查會把
    // 「查詢失敗」誤當「查無此 payment」而錯走 fallback 分支（重複 insert、
    // 靠 23505 收斂），故 error 一律 throw 到外層 catch → 回 Internal Error
    // 讓 ECPay 重送（CLAUDE.md §6：查詢失敗 ≠ 查無資料）。
    const { data: payment, error: paymentLookupError } = await serviceRole
      .from("payment")
      .select("id, status, order_id, amount")
      .eq("merchant_trade_no", merchantTradeNo)
      .maybeSingle();

    if (paymentLookupError) {
      throw new Error(`payment lookup failed: ${paymentLookupError.message}`);
    }

    if (!payment) {
      // pay page 預建失敗的邊緣情況：嘗試從 order_no 倒推（單一出處，T96/F-009）
      const orderNo = merchantTradeNoToOrderNo(merchantTradeNo);
      if (!orderNo) return ERR("Order not found");
      const { data: order, error: orderLookupError } = await serviceRole
        .from("orders")
        .select("id, status, total_amount")
        .eq("order_no", orderNo)
        .maybeSingle();

      if (orderLookupError) {
        // 同上：DB 故障不可回「Order not found」（會讓 ECPay 誤判為資料問題、
        // 燒掉有限重送額度），throw 讓外層回 Internal Error 觸發重送。
        throw new Error(`order lookup failed: ${orderLookupError.message}`);
      }
      if (!order) return ERR("Order not found");

      // 冪等：已有 paid payment → 確保訂單推進與通知都完成（避免上次執行半路
      // 失敗卡住），再回 1|OK。findPaidPayment 內含 { error } 檢查（會 throw）。
      const paidPayment = await findPaidPayment(serviceRole, order.id);

      if (paidPayment) return await settlePaid(serviceRole, order.id);

      const isPaid = params.RtnCode === "1";
      const now = new Date().toISOString();

      // 金額核對（縱深防禦）：ECPay 回傳金額須與訂單金額一致才可標記 paid。
      // 三道檢查（non-finite／non-positive／mismatch）收斂在 validateSettleAmount
      // 單一出處，只在 isPaid 時把關（失敗回呼的 RtnCode≠1 沒有標記 paid 的
      // 語意，金額不參與核對）。
      const tradeAmt = parseInt(params.TradeAmt ?? "0", 10);
      if (isPaid) {
        const check = validateSettleAmount(tradeAmt, order.total_amount);
        if (!check.ok) {
          if (check.reason !== "mismatch") {
            Sentry.captureMessage(
              `[ecpay/notify] ${check.reason} payment amount anomaly`,
              { level: "error", extra: { merchantTradeNo, tradeAmt } },
            );
          }
          return ERR("Amount mismatch");
        }
      }

      // 預建 payment 記錄不存在時的 fallback insert。amount 欄位有 CHECK
      //（> 0）＋NOT NULL：付款成立用已核對過的 tradeAmt；失敗回呼的 tradeAmt
      // 無意義（可能缺欄位→0／NaN，會撞 CHECK 讓 insert 靜默失敗、ECPay 空轉
      // 重送），改用訂單金額（必為正）記錄這筆失敗嘗試。
      const { error: insertError } = await serviceRole.from("payment").insert({
        order_id: order.id,
        merchant_trade_no: merchantTradeNo,
        gateway_trade_no: params.TradeNo ?? null,
        amount: isPaid ? tradeAmt : Number(order.total_amount),
        provider: "ecpay",
        status: isPaid ? "paid" : "failed",
        paid_at: isPaid ? now : null,
        raw_callback: params,
      });

      // unique_violation：並發請求已插入，視為冪等成功
      if (insertError && insertError.code !== PG_UNIQUE_VIOLATION) {
        return ERR("DB insert failed");
      }

      if (isPaid) return await settlePaid(serviceRole, order.id);

      return OK();
    }

    // 正常流程：payment 記錄已存在（由 pay page 預建）

    // 冪等：已 paid → 確保訂單推進與通知都完成（避免上次執行半路失敗卡住），
    // 再回 1|OK
    if (payment.status === "paid") {
      return await settlePaid(serviceRole, payment.order_id);
    }

    // 退款終態（T47）：這筆 payment 已 refunded（正規退款或 Override 補登記）。
    // ECPay 在其重送視窗內補送一次舊回呼會走到這裡——refunded 是終態，重複回呼
    // 是良性的、非新事件。直接回 1|OK 停止 ECPay 重送，不落入下方 pending→paid
    // 翻面（`.eq("status","pending")` 0 列 → 誤入 rescue 分支 `.eq("status",
    // "failed")` 也 0 列 → 誤報 error「not rescued」）與 settlePaid（訂單已終態，
    // ensureOrderPaid 會誤判「payment may be stuck」error）。記 info 供稽核。
    if (payment.status === "refunded") {
      Sentry.captureMessage(
        "ecpay/notify: duplicate callback on refunded payment (benign)",
        { level: "info", extra: { paymentId: payment.id, merchantTradeNo } },
      );
      return OK();
    }

    const isPaid = params.RtnCode === "1";
    const now = new Date().toISOString();

    // 金額核對（縱深防禦）：ECPay 回傳金額須與 payment 記錄金額一致才可標記
    // paid。三道檢查收斂在 validateSettleAmount 單一出處（與 fallback 分支、
    // reconcile 共用）。
    const tradeAmt = parseInt(params.TradeAmt ?? "0", 10);
    if (isPaid) {
      const check = validateSettleAmount(tradeAmt, payment.amount);
      if (!check.ok) {
        if (check.reason !== "mismatch") {
          Sentry.captureMessage(
            `[ecpay/notify] ${check.reason} payment amount anomaly`,
            { level: "error", extra: { merchantTradeNo, tradeAmt } },
          );
        }
        return ERR("Amount mismatch");
      }
    }

    // UPDATE 既有 payment 記錄（非 INSERT，無 unique constraint 衝突風險）
    // 檢查 error 原因同 ensureOrderPaid：暫時性 DB 錯誤不會 throw，只回傳
    // { error }；若不檢查，orders 可能已推進成 paid、信也寄了，但 payment
    // 卻永遠卡在 pending（gateway_trade_no/paid_at/raw_callback 全是
    // null），日後退款、對帳都查無 ECPay 交易號，且無法再被自動修正。
    // .select().maybeSingle() 檢查是否真的更新到列：T74 的付款頁可能在
    // webhook 抵達前一刻把這筆 payment 標成 failed（客人付款當下另一分頁
    // 剛好重整、判定序號過期）——0 列更新不是 error，若不檢查會靜默略過，
    // ECPay 交易號（退款唯一依據）就永遠沒記錄。
    const { data: paymentUpdated, error: paymentUpdateError } =
      await serviceRole
        .from("payment")
        .update({
          status: isPaid ? "paid" : "failed",
          gateway_trade_no: params.TradeNo ?? null,
          paid_at: isPaid ? now : null,
          raw_callback: params,
        })
        .eq("id", payment.id)
        .eq("status", "pending") // 只從 pending 往前推，防競態覆寫
        .select("id")
        .maybeSingle();

    if (paymentUpdateError) {
      throw new Error(`payment update failed: ${paymentUpdateError.message}`);
    }

    if (!paymentUpdated && isPaid) {
      // 沒更新到列＝這筆已不是 pending。錢確定收到了（isPaid＋驗章＋金額核對
      // 都過），若是被 T74 標成 failed 的競態，把它救回 paid 並補齊 ECPay
      // 交易資訊（uq_payment_one_paid_per_order 保證同訂單不會出現兩筆 paid，
      // 若已有另一筆 paid 這裡會 23505——記錄後放行，訂單推進不受影響）。
      const { data: rescued, error: rescueError } = await serviceRole
        .from("payment")
        .update({
          status: "paid",
          gateway_trade_no: params.TradeNo ?? null,
          paid_at: now,
          raw_callback: params,
        })
        .eq("id", payment.id)
        .eq("status", "failed")
        .select("id")
        .maybeSingle();

      Sentry.captureMessage(
        rescued
          ? "ecpay/notify: rescued mark-failed payment back to paid (T74 race)"
          : "ecpay/notify: paid webhook hit non-pending payment, not rescued",
        {
          level: rescued ? "warning" : "error",
          extra: {
            paymentId: payment.id,
            merchantTradeNo,
            rescueError: rescueError?.message ?? null,
          },
        },
      );
    }

    // 訂單推進與通知寄送各自冪等，ensureOrderPaid 內部會重新確認目前狀態
    // 才決定是否真的要推進，不需要在這裡先查一次 orders.status。
    if (isPaid) return await settlePaid(serviceRole, payment.order_id);

    return OK();
  } catch (e) {
    console.error("[ecpay/notify] unhandled error", { merchantTradeNo }, e);
    Sentry.captureException(e, { extra: { merchantTradeNo } });
    return ERR("Internal Error");
  }
}
