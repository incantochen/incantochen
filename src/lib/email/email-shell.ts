import "server-only";
import { escapeHtml } from "@/lib/email/escape-html";

// 寄件人（單一出處，T136）：所有信件檔 import 此常數，勿各自宣告複本。
// TODO(T35): 網域驗證後改 verified custom domain（例：orders@incantochen.com），
// 只需改這一行、全部信件跟著換。
export const FROM_EMAIL = "incantochen <onboarding@resend.dev>";

// PostgREST 巢狀 to-one 關聯（member／product／orders 等）在生成型別/回傳可能
// 是物件或單元素陣列——單一出處解包，勿各檔手刻 Array.isArray 分支（T136）。
// 回傳關聯列本身或 null；取欄位由呼叫端 `unwrapOne(x)?.email` / `?.name`。
export function unwrapOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

// 客人信外殼（T136）：置中金字 logo header ＋ eyebrow ＋ 標題 ＋ body slot ＋
// 「登入查看訂單」CTA ＋「© incantochen」footer。訂單確認／出貨／退款共用。
// eyebrow／heading／title 為本站控制字串，但 heading 可能含客人姓名——呼叫端
// 須先 escapeHtml 再傳入（與既有慣例一致）；bodyHtml 由呼叫端組好、內含客人
// 輸入處須已 escape。
export function renderCustomerEmailShell(opts: {
  title: string;
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  loginUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${opts.title}</title>
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

              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;">${opts.eyebrow}</p>
              <h1 style="margin:0 0 20px;font-size:22px;font-weight:400;color:#111;line-height:1.3;">${opts.heading}</h1>
              ${opts.bodyHtml}

              <!-- CTA -->
              <div style="text-align:center;margin-bottom:8px;">
                <a href="${opts.loginUrl}"
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
