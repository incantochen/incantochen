import "server-only"
import { Resend } from "resend"
import { serverEnv } from "@/lib/env.server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { escapeHtml } from "@/lib/email/escape-html"
import {
  FROM_EMAIL,
  renderEmailShell,
  unwrapMemberEmail,
} from "@/lib/email/email-shell"

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

  const customerEmail = unwrapMemberEmail(order.member)

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

  const bodyHtml = `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;font-size:13px;">
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
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:0;border-top:2px solid #111;padding-top:12px;">
      <tr>
        <td style="font-size:14px;font-weight:600;color:#111;">總計</td>
        <td style="text-align:right;font-size:16px;font-weight:700;color:#111;">NT$${order.total_amount.toLocaleString()}</td>
      </tr>
    </table>`

  const html = renderEmailShell({
    headerLabel: "incantochen — 店家通知",
    eyebrow: "新訂單",
    title: order.order_no,
    bodyHtml,
    footerNote:
      "後台訂單管理功能於 M2 上線前，請至 Supabase Dashboard 查看訂單詳情。",
  })

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
