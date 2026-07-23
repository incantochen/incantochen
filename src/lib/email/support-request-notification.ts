import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/lib/env.server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  FROM_EMAIL,
  renderEmailShell,
  renderLabelValueTable,
  unwrapOne,
} from "@/lib/email/email-shell";
import {
  REQUEST_TYPE_LABELS,
  type SupportRequestType,
} from "@/lib/support/support-request";

// 營運通知收件人讀 env（消滅寫死複本，換信箱只需改 Vercel Dashboard 一處）。
// 現況與 requireAdmin() 共用 ADMIN_EMAIL；「後台權限身分 vs 營運通知收件人」
// 長期拆兩個 env var 屬 T09 範圍，此處不做。
const OWNER_EMAIL = serverEnv.ADMIN_EMAIL;

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

  const order = unwrapOne(request.orders);
  const customerEmail = unwrapOne(request.member)?.email;

  const requestType = request.request_type as SupportRequestType;
  const typeLabel = REQUEST_TYPE_LABELS[requestType];

  const html = renderEmailShell({
    headerLabel: "incantochen — 店家通知",
    eyebrow: "售後申請",
    title: order?.order_no ?? "—",
    bodyHtml: renderLabelValueTable([
      { label: "類型", value: typeLabel },
      { label: "客人姓名", value: order?.recipient_name ?? "—" },
      { label: "客人 Email", value: customerEmail ?? "—" },
      { label: "說明", value: request.description },
    ]),
    footerNote: "請直接回覆本信與客人聯繫，並視需要向客人索取佐證照片。",
  });

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: OWNER_EMAIL,
    replyTo: customerEmail ?? undefined,
    subject: `[售後申請] ${order?.order_no ?? "—"} — ${typeLabel}`,
    html,
  });
  // Resend API 層級錯誤不會 throw，只回傳 { error }；明確轉成 throw
  // 才能讓呼叫端（support/actions.ts）的 log／後續處理知道信其實沒寄出。
  if (error) {
    throw new Error(
      `Resend error: ${error.name} ${error.message} (status ${error.statusCode})`,
    );
  }
}
