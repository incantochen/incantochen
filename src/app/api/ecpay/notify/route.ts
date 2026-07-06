import "server-only";
import * as Sentry from "@sentry/nextjs";
import { verifyCheckMacValue } from "@/lib/ecpay/check-mac-value";
import { serverEnv } from "@/lib/env.server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ensureOrderPaid,
  ensureNotificationSent,
} from "@/lib/order/ensure-paid";

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

export async function POST(request: Request) {
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

    const merchantTradeNo = params.MerchantTradeNo;
    if (!merchantTradeNo) return ERR("MerchantTradeNo missing");

    const serviceRole = createServiceRoleClient();

    // 查訂單：MerchantTradeNo = order_no 去 hyphen + 2 字元後綴（T53），
    // 先查 payment 表以取得 order_id（不再依賴字串解析）
    const { data: payment } = await serviceRole
      .from("payment")
      .select("id, status, order_id, amount")
      .eq("merchant_trade_no", merchantTradeNo)
      .maybeSingle();

    if (!payment) {
      // pay page 預建失敗的邊緣情況：嘗試從 order_no 倒推（兼容舊格式）
      const orderNo = `${merchantTradeNo.slice(0, 3)}-${merchantTradeNo.slice(3, 11)}-${merchantTradeNo.slice(11, 17)}`;
      const { data: order } = await serviceRole
        .from("orders")
        .select("id, status, total_amount")
        .eq("order_no", orderNo)
        .maybeSingle();

      if (!order) return ERR("Order not found");

      // 冪等：已有 paid payment → 確保訂單推進與通知都完成（避免上次執行半路
      // 失敗卡住），再回 1|OK
      const { data: paidPayment } = await serviceRole
        .from("payment")
        .select("id")
        .eq("order_id", order.id)
        .eq("status", "paid")
        .maybeSingle();

      if (paidPayment) {
        await ensureOrderPaid(serviceRole, order.id, "webhook");
        await ensureNotificationSent(serviceRole, order.id);
        return OK();
      }

      const isPaid = params.RtnCode === "1";
      const now = new Date().toISOString();

      // 金額核對（縱深防禦）：ECPay 回傳金額須與訂單金額一致才可標記 paid
      // Number(...) 轉型：total_amount 為 numeric(12,0)，PostgREST 有時會序列化成字串，
      // 直接用 !== 比對 number 與 string 永遠不相等，會誤判所有正常付款為金額不符。
      // Number.isFinite 防呆：TradeAmt 若為空字串／非數字格式，parseInt 回傳 NaN，
      // 明確擋下並記錄，避免用 NaN 跟任何數字比對都不相等而誤判金額不符。
      const tradeAmt = parseInt(params.TradeAmt ?? "0", 10);
      if (isPaid && !Number.isFinite(tradeAmt)) {
        console.error("[ecpay/notify] TradeAmt 格式異常", params.TradeAmt);
        Sentry.captureMessage("[ecpay/notify] TradeAmt 格式異常", {
          level: "error",
          extra: { tradeAmt: params.TradeAmt },
        });
        return ERR("Amount mismatch");
      }
      if (isPaid && tradeAmt !== Number(order.total_amount)) {
        return ERR("Amount mismatch");
      }

      // 預建 payment 記錄不存在時的 fallback insert
      const { error: insertError } = await serviceRole.from("payment").insert({
        order_id: order.id,
        merchant_trade_no: merchantTradeNo,
        gateway_trade_no: params.TradeNo ?? null,
        amount: tradeAmt,
        provider: "ecpay",
        status: isPaid ? "paid" : "failed",
        paid_at: isPaid ? now : null,
        raw_callback: params,
      });

      // 23505 = unique_violation：並發請求已插入，視為冪等成功
      if (insertError && insertError.code !== "23505") {
        return ERR("DB insert failed");
      }

      if (isPaid) {
        await ensureOrderPaid(serviceRole, order.id, "webhook");
        await ensureNotificationSent(serviceRole, order.id);
      }

      return OK();
    }

    // 正常流程：payment 記錄已存在（由 pay page 預建）

    // 冪等：已 paid → 確保訂單推進與通知都完成（避免上次執行半路失敗卡住），
    // 再回 1|OK
    if (payment.status === "paid") {
      await ensureOrderPaid(serviceRole, payment.order_id, "webhook");
      await ensureNotificationSent(serviceRole, payment.order_id);
      return OK();
    }

    const isPaid = params.RtnCode === "1";
    const now = new Date().toISOString();

    // 金額核對（縱深防禦）：ECPay 回傳金額須與 payment 記錄金額一致才可標記 paid
    // Number(...) 轉型原因同上：payment.amount 也是 numeric(12,0)。
    // Number.isFinite 防呆原因同上。
    const tradeAmt = parseInt(params.TradeAmt ?? "0", 10);
    if (isPaid && !Number.isFinite(tradeAmt)) {
      console.error("[ecpay/notify] TradeAmt 格式異常", params.TradeAmt);
      Sentry.captureMessage("[ecpay/notify] TradeAmt 格式異常", {
        level: "error",
        extra: { tradeAmt: params.TradeAmt },
      });
      return ERR("Amount mismatch");
    }
    if (isPaid && tradeAmt !== Number(payment.amount)) {
      return ERR("Amount mismatch");
    }

    // UPDATE 既有 payment 記錄（非 INSERT，無 unique constraint 衝突風險）
    // 檢查 error 原因同 ensureOrderPaid：暫時性 DB 錯誤不會 throw，只回傳
    // { error }；若不檢查，orders 可能已推進成 paid、信也寄了，但 payment
    // 卻永遠卡在 pending（gateway_trade_no/paid_at/raw_callback 全是
    // null），日後退款、對帳都查無 ECPay 交易號，且無法再被自動修正。
    const { error: paymentUpdateError } = await serviceRole
      .from("payment")
      .update({
        status: isPaid ? "paid" : "failed",
        gateway_trade_no: params.TradeNo ?? null,
        paid_at: isPaid ? now : null,
        raw_callback: params,
      })
      .eq("id", payment.id)
      .eq("status", "pending"); // 只從 pending 往前推，防競態覆寫

    if (paymentUpdateError) {
      throw new Error(`payment update failed: ${paymentUpdateError.message}`);
    }

    // 訂單推進與通知寄送各自冪等，ensureOrderPaid 內部會重新確認目前狀態
    // 才決定是否真的要推進，不需要在這裡先查一次 orders.status。
    if (isPaid) {
      await ensureOrderPaid(serviceRole, payment.order_id, "webhook");
      await ensureNotificationSent(serviceRole, payment.order_id);
    }

    return OK();
  } catch (e) {
    console.error("[ecpay/notify] unhandled error", e);
    Sentry.captureException(e);
    return ERR("Internal Error");
  }
}
