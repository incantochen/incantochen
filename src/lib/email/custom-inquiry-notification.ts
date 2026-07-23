import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/lib/env.server";
import {
  renderEmailShell,
  renderLabelValueTable,
} from "@/lib/email/email-shell";
import { BUDGET_LABELS, CATEGORY_LABELS } from "@/lib/custom-inquiry/labels";
import type {
  CustomInquiryBudget,
  CustomInquiryCategory,
} from "@/lib/custom-inquiry/schema";

// TODO(T35): switch to verified custom domain before go-live
const FROM_EMAIL = "incantochen <onboarding@resend.dev>";
// 營運通知收件人讀 env（與 support-request-notification 同源；換信箱只改 Dashboard 一處）。
const OWNER_EMAIL = serverEnv.ADMIN_EMAIL;

// 寄信函式直接吃 action insert 回傳的整列，不再各自依 id 重查 DB（省 2 次 round-trip、
// 且消去「重查失敗」的錯誤面）。
export type CustomInquiryEmailData = {
  category: string;
  budget_band: string;
  idea: string;
  email: string;
  phone: string | null;
  preferred_time: string | null;
};

function labelsOf(row: CustomInquiryEmailData) {
  const categoryLabel =
    CATEGORY_LABELS[row.category as CustomInquiryCategory] ?? row.category;
  const budgetLabel =
    BUDGET_LABELS[row.budget_band as CustomInquiryBudget] ?? row.budget_band;
  return { categoryLabel, budgetLabel };
}

// 店家通知信：可直接回覆本信與客人聯繫（replyTo = 客人 email）。
export async function sendCustomInquiryNotification(
  inquiry: CustomInquiryEmailData,
): Promise<void> {
  const { categoryLabel, budgetLabel } = labelsOf(inquiry);
  const html = renderEmailShell({
    headerLabel: "incantochen — 店家通知",
    eyebrow: "全客製預約",
    title: `${categoryLabel} · ${budgetLabel}`,
    bodyHtml: renderLabelValueTable([
      { label: "品項", value: categoryLabel },
      { label: "預算範圍", value: budgetLabel },
      { label: "想法", value: inquiry.idea },
      { label: "Email", value: inquiry.email },
      { label: "電話", value: inquiry.phone ?? "—" },
      { label: "方便時段", value: inquiry.preferred_time ?? "—" },
    ]),
    footerNote: "請直接回覆本信與客人聯繫，安排一對一訂製諮詢。",
  });

  const resend = new Resend(serverEnv.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: OWNER_EMAIL,
    replyTo: inquiry.email,
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
  inquiry: CustomInquiryEmailData,
): Promise<void> {
  const { categoryLabel, budgetLabel } = labelsOf(inquiry);
  const intro = `<p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#374151;">謝謝妳與我們分享想法。我們已收到妳的全客製預約，將盡快以 Email 與妳聯繫，一起從選石、草圖到成品，打造完全屬於妳的設計。</p>`;
  const html = renderEmailShell({
    headerLabel: "incantochen",
    eyebrow: "預約訂製",
    title: "已收到妳的預約",
    bodyHtml:
      intro +
      renderLabelValueTable([
        { label: "品項", value: categoryLabel },
        { label: "預算範圍", value: budgetLabel },
        { label: "想法", value: inquiry.idea },
      ]),
    footerNote: "如需補充，直接回覆本信即可。",
  });

  const resend = new Resend(serverEnv.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: inquiry.email,
    subject: "已收到妳的全客製預約 — incantochen",
    html,
  });
  if (error) {
    throw new Error(
      `Resend error: ${error.name} ${error.message} (status ${error.statusCode})`,
    );
  }
}
