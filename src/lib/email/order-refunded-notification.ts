import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/lib/env.server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { escapeHtml } from "@/lib/email/escape-html";

// TODO(T35): switch to verified custom domain (e.g. orders@incantochen.com) before go-live
const FROM_EMAIL = "incantochen <onboarding@resend.dev>";

function buildEmailHtml(params: {
  orderNo: string;
  recipientName: string;
  totalAmount: number;
  loginUrl: string;
}): string {
  const { orderNo, recipientName, totalAmount, loginUrl } = params;
  const safeRecipientName = escapeHtml(recipientName);

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>退款通知</title>
</head>
<body style="margin:0;padding:0;background:#f9f7f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f7f4;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:4px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#0f3325;padding:28px 40px;text-align:center;">
              <div style="font-size:22px;letter-spacing:0.12em;color:#c9a84c;font-weight:400;">incantochen</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">

              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;">退款通知</p>
              <h1 style="margin:0 0 20px;font-size:22px;font-weight:400;color:#111;line-height:1.3;">您的訂單退款已辦理，${safeRecipientName}</h1>
              <p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">
                我們已為您辦理退款。款項將退回您原刷卡的信用卡帳戶，實際入帳時間依各發卡銀行作業而定，約 3–7 個工作天。
              </p>

              <!-- Order number -->
              <div style="background:#f9f7f4;border-radius:4px;padding:16px 20px;margin-bottom:16px;">
                <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">訂單號碼</div>
                <div style="font-family:monospace;font-size:16px;font-weight:600;color:#111;">${orderNo}</div>
              </div>

              <!-- Refund amount -->
              <div style="background:#f9f7f4;border-radius:4px;padding:16px 20px;margin-bottom:32px;">
                <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">退款金額</div>
                <div style="font-size:17px;font-weight:700;color:#111;">NT$${totalAmount.toLocaleString()}</div>
              </div>

              <!-- CTA -->
              <div style="text-align:center;margin-bottom:8px;">
                <a href="${loginUrl}"
                   style="display:inline-block;padding:12px 32px;background:#0f3325;color:#fff;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;text-decoration:none;border-radius:2px;">
                  登入查看訂單
                </a>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                如有任何問題，請回覆此信件或聯絡我們。<br />
                © incantochen
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
    .select("order_no, recipient_name, total_amount, member:member_id(email)")
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

  const memberData = order.member;
  const email = Array.isArray(memberData)
    ? memberData[0]?.email
    : memberData?.email;
  if (!email) return;

  const loginUrl = `${serverEnv.NEXT_PUBLIC_SITE_URL}/login`;

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `您的訂單退款已辦理 — 訂單 ${order.order_no}`,
    html: buildEmailHtml({
      orderNo: order.order_no,
      recipientName: order.recipient_name,
      // numeric 欄位 PostgREST 可能回字串（生成型別仍標 number），先 Number()
      // 再 toLocaleString，避免字串上調用出現 "1000" 未加千分位的錯排。
      totalAmount: Number(order.total_amount),
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
