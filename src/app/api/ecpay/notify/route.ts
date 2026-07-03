import "server-only";
import { verifyCheckMacValue } from "@/lib/ecpay/check-mac-value";
import { serverEnv } from "@/lib/env.server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendOrderConfirmation } from "@/lib/email/order-confirmation";
import { sendNewOrderNotification } from "@/lib/email/new-order-notification";
import { sendOnce } from "@/lib/notification/send-once";

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

      // 冪等：已有 paid payment → 直接 1|OK
      const { data: paidPayment } = await serviceRole
        .from("payment")
        .select("id")
        .eq("order_id", order.id)
        .eq("status", "paid")
        .maybeSingle();

      if (paidPayment) return OK();

      const isPaid = params.RtnCode === "1";
      const now = new Date().toISOString();

      // 金額核對（縱深防禦）：ECPay 回傳金額須與訂單金額一致才可標記 paid
      const tradeAmt = parseInt(params.TradeAmt ?? "0", 10);
      if (isPaid && tradeAmt !== order.total_amount) {
        return ERR("Amount mismatch");
      }

      // 預建 payment 記錄不存在時的 fallback insert
      const { error: insertError } = await serviceRole.from("payment").insert({
        order_id: order.id,
        merchant_trade_no: merchantTradeNo,
        gateway_trade_no: params.TradeNo ?? null,
        amount: parseInt(params.TradeAmt ?? "0", 10),
        provider: "ecpay",
        status: isPaid ? "paid" : "failed",
        paid_at: isPaid ? now : null,
        raw_callback: params,
      });

      // 23505 = unique_violation：並發請求已插入，視為冪等成功
      if (insertError && insertError.code !== "23505") {
        return ERR("DB insert failed");
      }

      if (isPaid && order.status === "pending_payment") {
        await serviceRole
          .from("orders")
          .update({ status: "paid" })
          .eq("id", order.id);
        void serviceRole.from("order_status_log").insert({
          order_id: order.id,
          from_status: "pending_payment",
          to_status: "paid",
          note: "ECPay webhook",
          actor_id: null,
          is_override: false,
        });
        await sendOnce(serviceRole, {
          orderId: order.id,
          type: "order_confirmation",
          send: () => sendOrderConfirmation(order.id),
        });
        await sendOnce(serviceRole, {
          orderId: order.id,
          type: "new_order_notification",
          send: () => sendNewOrderNotification(order.id),
        });
      }

      return OK();
    }

    // 正常流程：payment 記錄已存在（由 pay page 預建）

    // 冪等：已 paid → 直接 1|OK
    if (payment.status === "paid") return OK();

    const isPaid = params.RtnCode === "1";
    const now = new Date().toISOString();

    // 金額核對（縱深防禦）：ECPay 回傳金額須與 payment 記錄金額一致才可標記 paid
    const tradeAmt = parseInt(params.TradeAmt ?? "0", 10);
    if (isPaid && tradeAmt !== payment.amount) {
      return ERR("Amount mismatch");
    }

    // UPDATE 既有 payment 記錄（非 INSERT，無 unique constraint 衝突風險）
    await serviceRole
      .from("payment")
      .update({
        status: isPaid ? "paid" : "failed",
        gateway_trade_no: params.TradeNo ?? null,
        paid_at: isPaid ? now : null,
        raw_callback: params,
      })
      .eq("id", payment.id)
      .eq("status", "pending"); // 只從 pending 往前推，防競態覆寫

    // 訂單狀態只從 pending_payment 往前推
    if (isPaid) {
      const { data: order } = await serviceRole
        .from("orders")
        .select("status")
        .eq("id", payment.order_id)
        .single();

      if (order?.status === "pending_payment") {
        await serviceRole
          .from("orders")
          .update({ status: "paid" })
          .eq("id", payment.order_id);
        void serviceRole.from("order_status_log").insert({
          order_id: payment.order_id,
          from_status: "pending_payment",
          to_status: "paid",
          note: "ECPay webhook",
          actor_id: null,
          is_override: false,
        });
        await sendOnce(serviceRole, {
          orderId: payment.order_id,
          type: "order_confirmation",
          send: () => sendOrderConfirmation(payment.order_id),
        });
        await sendOnce(serviceRole, {
          orderId: payment.order_id,
          type: "new_order_notification",
          send: () => sendNewOrderNotification(payment.order_id),
        });
      }
    }

    return OK();
  } catch (e) {
    console.error("[ecpay/notify] unhandled error", e);
    return ERR("Internal Error");
  }
}
