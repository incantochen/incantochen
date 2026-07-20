import "server-only"
import { Resend } from "resend"
import { serverEnv } from "@/lib/env.server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { escapeHtml } from "@/lib/email/escape-html"

// TODO(T35): switch to verified custom domain before go-live
const FROM_EMAIL = "incantochen <onboarding@resend.dev>"
// 營運通知收件人讀 env（消滅寫死複本，換信箱只需改 Vercel Dashboard 一處）。
// 現況與 requireAdmin() 共用 ADMIN_EMAIL；「後台權限身分 vs 營運通知收件人」
// 長期拆兩個 env var 屬 T09 範圍，此處不做。
const OWNER_EMAIL = serverEnv.ADMIN_EMAIL

const selectionSchema = {
  parse(raw: unknown): { label: string }[] {
    if (!Array.isArray(raw)) return []
    return raw.flatMap((s) => {
      if (typeof s === "object" && s !== null && "label" in s) {
        return [{ label: String(s.label) }]
      }
      return []
    })
  },
}

export async function sendNewOrderNotification(orderId: string): Promise<void> {
  const resend = new Resend(serverEnv.RESEND_API_KEY)
  const serviceRole = createServiceRoleClient()

  const { data: order } = await serviceRole
    .from("orders")
    .select(
      `
      order_no, recipient_name, total_amount, shipping_address, zip_code,
      member:member_id(email),
      order_item(quantity, unit_price_snapshot, config_snapshot, product_name_snapshot, product:product_id(name))
    `,
    )
    .eq("id", orderId)
    .single()

  if (!order) return

  const memberData = order.member
  const customerEmail = Array.isArray(memberData)
    ? memberData[0]?.email
    : memberData?.email

  const items = (Array.isArray(order.order_item) ? order.order_item : []).map(
    (item) => {
      const p = item.product
      // 快照優先（下單當下名稱）；join 現值僅供 null 窗口 fallback
      const joinedName = Array.isArray(p) ? p[0]?.name : p?.name
      const productName = item.product_name_snapshot ?? joinedName ?? "商品"
      const snap = item.config_snapshot
      const selections =
        typeof snap === "object" && snap !== null && "selections" in snap
          ? selectionSchema.parse((snap as { selections: unknown }).selections)
          : []
      return {
        productName,
        quantity: item.quantity,
        unitPrice: item.unit_price_snapshot,
        selections,
      }
    },
  )

  const safeRecipientName = escapeHtml(order.recipient_name)
  const safeCustomerEmail = customerEmail ? escapeHtml(customerEmail) : null
  const addrLine = escapeHtml(
    order.zip_code
      ? `${order.zip_code} ${order.shipping_address}`
      : order.shipping_address,
  )

  const itemRows = items
    .map(
      (item) => `
  <tr>
    <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:14px;color:#111;font-weight:500;">${escapeHtml(item.productName)}</div>
      ${item.selections.length ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(item.selections.map((s) => s.label).join(" · "))}</div>` : ""}
      <div style="font-size:12px;color:#6b7280;margin-top:2px;">數量：${item.quantity}</div>
    </td>
    <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-size:14px;color:#111;white-space:nowrap;">
      NT$${(item.unitPrice * item.quantity).toLocaleString()}
    </td>
  </tr>`,
    )
    .join("")

  const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:4px;border:1px solid #e5e7eb;">
  <tr><td style="background:#0f3325;padding:20px 32px;">
    <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;">incantochen — 店家通知</div>
  </td></tr>
  <tr><td style="padding:28px 32px 0;">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#c9a84c;">新訂單</p>
    <h1 style="margin:0 0 24px;font-size:20px;font-weight:400;color:#111;">${order.order_no}</h1>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;font-size:13px;">
      <tr>
        <td style="color:#6b7280;padding:4px 0;width:80px;">客人姓名</td>
        <td style="color:#111;padding:4px 0;">${safeRecipientName}</td>
      </tr>
      <tr>
        <td style="color:#6b7280;padding:4px 0;">客人 Email</td>
        <td style="color:#111;padding:4px 0;">${safeCustomerEmail ?? "—"}</td>
      </tr>
      <tr>
        <td style="color:#6b7280;padding:4px 0;">收件地址</td>
        <td style="color:#111;padding:4px 0;">${addrLine}</td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <thead><tr>
        <th style="text-align:left;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#9ca3af;padding-bottom:6px;border-bottom:1px solid #e5e7eb;">商品</th>
        <th style="text-align:right;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#9ca3af;padding-bottom:6px;border-bottom:1px solid #e5e7eb;">金額</th>
      </tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;border-top:2px solid #111;padding-top:12px;">
      <tr>
        <td style="font-size:14px;font-weight:600;color:#111;">總計</td>
        <td style="text-align:right;font-size:16px;font-weight:700;color:#111;">NT$${order.total_amount.toLocaleString()}</td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">後台訂單管理功能於 M2 上線前，請至 Supabase Dashboard 查看訂單詳情。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: OWNER_EMAIL,
    subject: `[新訂單] ${order.order_no} — NT$${order.total_amount.toLocaleString()}`,
    html,
  })
  // Resend API 層級錯誤不會 throw，只回傳 { error }；必須明確轉成 throw，
  // sendOnce（T69）才能正確判斷失敗並標記 failed 以利重試。
  if (error) {
    throw new Error(
      `Resend error: ${error.name} ${error.message} (status ${error.statusCode})`,
    )
  }
}
