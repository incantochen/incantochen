import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/lib/env.server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { escapeHtml } from "@/lib/email/escape-html";
import {
  FROM_EMAIL,
  renderCustomerEmailShell,
  unwrapOne,
} from "@/lib/email/email-shell";

function buildEmailHtml(params: {
  orderNo: string;
  recipientName: string;
  loginUrl: string;
}): string {
  const { orderNo, recipientName, loginUrl } = params;
  const safeRecipientName = escapeHtml(recipientName);
  // order_no 目前系統生成為純英數低風險，但仍插進 HTML——與同檔 recipientName
  // 的 escape 慣例一致（防禦性，防日後 order_no 生成規則放寬引入特殊字元）。
  const safeOrderNo = escapeHtml(orderNo);

  const bodyHtml = `
              <p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">
                我們已為您辦理退款。退款金額以綠界（ECPay）實際退刷金額為準，款項將退回您原刷卡的信用卡帳戶，實際入帳時間依各發卡銀行作業而定，約 3–7 個工作天。
              </p>

              <!-- Order number -->
              <div style="background:#f9f7f4;border-radius:4px;padding:16px 20px;margin-bottom:32px;">
                <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">訂單號碼</div>
                <div style="font-family:monospace;font-size:16px;font-weight:600;color:#111;">${safeOrderNo}</div>
              </div>`;

  return renderCustomerEmailShell({
    title: "退款通知",
    eyebrow: "退款通知",
    heading: `您的訂單退款已辦理，${safeRecipientName}`,
    bodyHtml,
    loginUrl,
  });
}

// T47/T87 退款通知信：整單全額退（退款金額＝orders.total_amount）。退款原因
// 僅入 order_status_log note 供內部稽核，刻意不進客人信件。
export async function sendOrderRefundedNotification(
  orderId: string,
): Promise<void> {
  const resend = new Resend(serverEnv.RESEND_API_KEY);
  const serviceRole = createServiceRoleClient();

  const { data: order, error: queryError } = await serviceRole
    .from("orders")
    .select("order_no, recipient_name, member:member_id(email)")
    .eq("id", orderId)
    .single();

  // PGRST116＝查無此列（理論上不會發生，orderId 來自已建立的訂單）：視為
  // 沒東西可寄，安靜跳過。其餘錯誤（timeout／連線池耗盡等）代表「查詢失敗」，
  // 若不分辨會被誤判成「訂單不存在」而靜默略過，必須 throw 讓 sendOnce 標記
  // failed 以利之後重試（見 CLAUDE.md §6 防禦性寫法通則）。
  if (queryError) {
    if (queryError.code === "PGRST116") return;
    throw new Error(
      `sendOrderRefundedNotification query failed: ${queryError.message}`,
    );
  }

  const email = unwrapOne(order.member)?.email;
  if (!email) return;

  const loginUrl = `${serverEnv.NEXT_PUBLIC_SITE_URL}/login`;

  // 刻意不寫具體退款金額（#2）：MVP 記錄式退款不擷取實際退刷金額，部分退刷
  // 情境下 order.total_amount 會高於實退而誤導客人；信文改「以綠界實際退刷
  // 金額為準」。日後做部分退款（衍生任務）再加 refund_amount 欄位回填。
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `您的訂單退款已辦理 — 訂單 ${order.order_no}`,
    html: buildEmailHtml({
      orderNo: order.order_no,
      recipientName: order.recipient_name,
      loginUrl,
    }),
  });
  // Resend API 層級錯誤（驗證失敗/超額/退信等）不會 throw，只回傳 { error }；
  // 必須明確轉成 throw，sendOnce 才能正確判斷失敗並標記 failed 以利重試。
  if (error) {
    throw new Error(
      `Resend error: ${error.name} ${error.message} (status ${error.statusCode})`,
    );
  }
}
