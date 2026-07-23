import "server-only";
import { escapeHtml } from "@/lib/email/escape-html";

// 共用 email 版型外殼：綠底 header ＋ eyebrow ＋ 標題 ＋ body slot ＋ footer。
// 店家通知（售後／全客製）等通知信共用，避免版型 copy-paste 失同步。
// headerLabel／eyebrow／title／footerNote 皆為本站控制的靜態字串（無客人輸入）；
// bodyHtml 由呼叫端組好——其中含客人自由輸入的部分必須已 escape（用 renderLabelValueTable
// 即自動處理）。
export function renderEmailShell(opts: {
  headerLabel: string;
  eyebrow: string;
  title: string;
  bodyHtml: string;
  footerNote: string;
}): string {
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
    <h1 style="margin:0 0 24px;font-size:20px;font-weight:400;color:#111;">${opts.title}</h1>
    ${opts.bodyHtml}
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">${opts.footerNote}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// label/value 摘要表：value 一律 escapeHtml（呼叫端傳原始值即可，勿自行先 escape 以免雙重）。
export function renderLabelValueTable(
  rows: Array<{ label: string; value: string }>,
): string {
  const rowsHtml = rows
    .map(
      (r) => `
      <tr>
        <td style="color:#6b7280;padding:4px 0;width:88px;vertical-align:top;">${r.label}</td>
        <td style="color:#111;padding:4px 0;white-space:pre-wrap;">${escapeHtml(r.value)}</td>
      </tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;font-size:13px;">${rowsHtml}
    </table>`;
}
