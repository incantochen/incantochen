import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/lib/env.server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  REQUEST_TYPE_LABELS,
  type SupportRequestType,
} from "@/lib/support/support-request";

// TODO(T35): switch to verified custom domain before go-live
const FROM_EMAIL = "incantochen <onboarding@resend.dev>";
// TODO(T35): move to env var when custom domain is set up
const OWNER_EMAIL = "fishead02290@gmail.com";

export async function sendSupportRequestNotification(
  requestId: string,
): Promise<void> {
  const resend = new Resend(serverEnv.RESEND_API_KEY);
  const serviceRole = createServiceRoleClient();

  const { data: request } = await serviceRole
    .from("support_request")
    .select(
      `
      request_type, description,
      orders:order_id(order_no, recipient_name),
      member:member_id(email)
    `,
    )
    .eq("id", requestId)
    .single();

  if (!request) return;

  const orderData = request.orders;
  const order = Array.isArray(orderData) ? orderData[0] : orderData;
  const memberData = request.member;
  const customerEmail = Array.isArray(memberData)
    ? memberData[0]?.email
    : memberData?.email;

  const requestType = request.request_type as SupportRequestType;
  const typeLabel = REQUEST_TYPE_LABELS[requestType];

  const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:4px;border:1px solid #e5e7eb;">
  <tr><td style="background:#0f3325;padding:20px 32px;">
    <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;">incantochen — 店家通知</div>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#c9a84c;">售後申請</p>
    <h1 style="margin:0 0 24px;font-size:20px;font-weight:400;color:#111;">${order?.order_no ?? "—"}</h1>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;font-size:13px;">
      <tr>
        <td style="color:#6b7280;padding:4px 0;width:80px;vertical-align:top;">類型</td>
        <td style="color:#111;padding:4px 0;">${typeLabel}</td>
      </tr>
      <tr>
        <td style="color:#6b7280;padding:4px 0;vertical-align:top;">客人姓名</td>
        <td style="color:#111;padding:4px 0;">${order?.recipient_name ?? "—"}</td>
      </tr>
      <tr>
        <td style="color:#6b7280;padding:4px 0;vertical-align:top;">客人 Email</td>
        <td style="color:#111;padding:4px 0;">${customerEmail ?? "—"}</td>
      </tr>
      <tr>
        <td style="color:#6b7280;padding:4px 0;vertical-align:top;">說明</td>
        <td style="color:#111;padding:4px 0;white-space:pre-wrap;">${request.description}</td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">請直接回覆本信與客人聯繫，並視需要向客人索取佐證照片。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: OWNER_EMAIL,
    replyTo: customerEmail ?? undefined,
    subject: `[售後申請] ${order?.order_no ?? "—"} — ${typeLabel}`,
    html,
  });
}
