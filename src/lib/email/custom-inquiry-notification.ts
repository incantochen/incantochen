import "server-only";
import * as Sentry from "@sentry/nextjs";
import { Resend } from "resend";
import { serverEnv } from "@/lib/env.server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { escapeHtml } from "@/lib/email/escape-html";
import { BUDGET_LABELS, CATEGORY_LABELS } from "@/lib/custom-inquiry/labels";
import type {
  CustomInquiryBudget,
  CustomInquiryCategory,
} from "@/lib/custom-inquiry/schema";

// TODO(T35): switch to verified custom domain before go-live
const FROM_EMAIL = "incantochen <onboarding@resend.dev>";
// 營運通知收件人讀 env（與 support-request-notification 同源；換信箱只改 Dashboard 一處）。
const OWNER_EMAIL = serverEnv.ADMIN_EMAIL;

type InquiryRow = {
  category: string;
  budget_band: string;
  idea: string;
  email: string;
  phone: string | null;
  preferred_time: string | null;
};

async function fetchInquiry(inquiryId: string): Promise<InquiryRow | null> {
  const serviceRole = createServiceRoleClient();
  const { data, error } = await serviceRole
    .from("custom_inquiry")
    .select("category, budget_band, idea, email, phone, preferred_time")
    .eq("id", inquiryId)
    .single();
  // §6：查詢失敗 ≠ 查無資料——DB 暫時性故障（逾時／連線池耗盡）不可誤判成「查無此列」
  // 而靜默略過寄信。轉 throw 讓呼叫端（action try/catch）知道信沒寄出，並記 Sentry
  // 供人工補救；真正查無資料（data null、error null）才回 null。
  if (error) {
    Sentry.captureException(error, {
      tags: { area: "custom-inquiry-email" },
      extra: { inquiryId },
    });
    throw new Error(`custom_inquiry fetch failed: ${error.message}`);
  }
  return data;
}

function labelsOf(row: InquiryRow) {
  const categoryLabel =
    CATEGORY_LABELS[row.category as CustomInquiryCategory] ?? row.category;
  const budgetLabel =
    BUDGET_LABELS[row.budget_band as CustomInquiryBudget] ?? row.budget_band;
  return { categoryLabel, budgetLabel };
}

// 共用 email 版型：綠底 header ＋ eyebrow ＋ 標題 ＋（可選）開場段 ＋ label/value 表 ＋
// footer。店家通知信與客人確認信只組不同內容，避免版型 copy-paste 失同步。
// headerLabel／eyebrow／title／intro／footerNote 皆為本站控制的靜態字串（無客人輸入）；
// rows 的 value 可能含客人自由輸入，一律 escapeHtml。
function renderInquiryEmail(opts: {
  headerLabel: string;
  eyebrow: string;
  title: string;
  intro?: string;
  rows: Array<{ label: string; value: string }>;
  footerNote: string;
}): string {
  const rowsHtml = opts.rows
    .map(
      (r) => `
      <tr>
        <td style="color:#6b7280;padding:4px 0;width:88px;vertical-align:top;">${r.label}</td>
        <td style="color:#111;padding:4px 0;white-space:pre-wrap;">${escapeHtml(r.value)}</td>
      </tr>`,
    )
    .join("");
  const introHtml = opts.intro
    ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#374151;">${opts.intro}</p>`
    : "";
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:4px;border:1px solid #e5e7eb;">
  <tr><td style="background:#0f3325;padding:20px 32px;">
    <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;">${opts.headerLabel}</div>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#c9a84c;">${opts.eyebrow}</p>
    <h1 style="margin:0 0 ${opts.intro ? "16px" : "24px"};font-size:20px;font-weight:400;color:#111;">${opts.title}</h1>
    ${introHtml}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;font-size:13px;">${rowsHtml}
    </table>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">${opts.footerNote}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// 店家通知信：可直接回覆本信與客人聯繫（replyTo = 客人 email）。
export async function sendCustomInquiryNotification(
  inquiryId: string,
): Promise<void> {
  const row = await fetchInquiry(inquiryId);
  if (!row) return;

  const { categoryLabel, budgetLabel } = labelsOf(row);
  const html = renderInquiryEmail({
    headerLabel: "incantochen — 店家通知",
    eyebrow: "全客製預約",
    title: `${categoryLabel} · ${budgetLabel}`,
    rows: [
      { label: "品項", value: categoryLabel },
      { label: "預算範圍", value: budgetLabel },
      { label: "想法", value: row.idea },
      { label: "Email", value: row.email },
      { label: "電話", value: row.phone ?? "—" },
      { label: "方便時段", value: row.preferred_time ?? "—" },
    ],
    footerNote: "請直接回覆本信與客人聯繫，安排一對一訂製諮詢。",
  });

  const resend = new Resend(serverEnv.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: OWNER_EMAIL,
    replyTo: row.email,
    subject: `[全客製預約] ${categoryLabel} — ${budgetLabel}`,
    html,
  });
  // Resend API 層級錯誤不 throw，只回傳 { error }；明確轉 throw 讓呼叫端知道沒寄出。
  if (error) {
    throw new Error(
      `Resend error: ${error.name} ${error.message} (status ${error.statusCode})`,
    );
  }
}

// 客人確認信：「已收到，將盡快與妳聯繫」＋摘要。
export async function sendCustomInquiryConfirmation(
  inquiryId: string,
): Promise<void> {
  const row = await fetchInquiry(inquiryId);
  if (!row) return;

  const { categoryLabel, budgetLabel } = labelsOf(row);
  const html = renderInquiryEmail({
    headerLabel: "incantochen",
    eyebrow: "預約訂製",
    title: "已收到妳的預約",
    intro:
      "謝謝妳與我們分享想法。我們已收到妳的全客製預約，將盡快以 Email 與妳聯繫，一起從選石、草圖到成品，打造完全屬於妳的設計。",
    rows: [
      { label: "品項", value: categoryLabel },
      { label: "預算範圍", value: budgetLabel },
      { label: "想法", value: row.idea },
    ],
    footerNote: "如需補充，直接回覆本信即可。",
  });

  const resend = new Resend(serverEnv.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: row.email,
    subject: "已收到妳的全客製預約 — incantochen",
    html,
  });
  if (error) {
    throw new Error(
      `Resend error: ${error.name} ${error.message} (status ${error.statusCode})`,
    );
  }
}
