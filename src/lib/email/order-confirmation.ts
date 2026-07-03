import "server-only"
import { Resend } from "resend"
import { serverEnv } from "@/lib/env.server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

// TODO(T35): switch to verified custom domain (e.g. orders@incantochen.com) before go-live
const FROM_EMAIL = "incantochen <onboarding@resend.dev>"

const selectionSchema = {
  parse(raw: unknown): { label: string; price_delta: number }[] {
    if (!Array.isArray(raw)) return []
    return raw.flatMap((s) => {
      if (
        typeof s === "object" &&
        s !== null &&
        "label" in s &&
        "price_delta" in s
      ) {
        return [{ label: String(s.label), price_delta: Number(s.price_delta) }]
      }
      return []
    })
  },
}

function buildEmailHtml(params: {
  orderNo: string
  recipientName: string
  totalAmount: number
  shippingAddress: string
  zipCode: string | null
  loginUrl: string
  items: {
    productName: string
    quantity: number
    unitPrice: number
    selections: { label: string; price_delta: number }[]
  }[]
}): string {
  const {
    orderNo,
    recipientName,
    totalAmount,
    shippingAddress,
    zipCode,
    loginUrl,
    items,
  } = params

  const itemRows = items
    .map((item) => {
      const configLine = item.selections.map((s) => s.label).join(" · ")
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;vertical-align:top;">
            <div style="font-size:15px;color:#111;font-weight:500;">${item.productName}</div>
            ${configLine ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">${configLine}</div>` : ""}
            <div style="font-size:13px;color:#6b7280;margin-top:2px;">數量：${item.quantity}</div>
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;white-space:nowrap;">
            <span style="font-size:15px;color:#111;">NT$${(item.unitPrice * item.quantity).toLocaleString()}</span>
          </td>
        </tr>`
    })
    .join("")

  const addressLine = zipCode
    ? `${zipCode} ${shippingAddress}`
    : shippingAddress

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>訂單確認</title>
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

              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;">付款成功</p>
              <h1 style="margin:0 0 20px;font-size:22px;font-weight:400;color:#111;line-height:1.3;">感謝您的訂購，${recipientName}</h1>
              <p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">
                我們已收到您的付款，將盡快為您精心製作。完成後我們會主動與您聯繫。
              </p>

              <!-- Order number -->
              <div style="background:#f9f7f4;border-radius:4px;padding:16px 20px;margin-bottom:32px;">
                <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">訂單號碼</div>
                <div style="font-family:monospace;font-size:16px;font-weight:600;color:#111;">${orderNo}</div>
              </div>

              <!-- Items -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <thead>
                  <tr>
                    <th style="text-align:left;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;padding-bottom:8px;border-bottom:1px solid #e5e7eb;">商品</th>
                    <th style="text-align:right;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;padding-bottom:8px;border-bottom:1px solid #e5e7eb;">金額</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
              </table>

              <!-- Total -->
              <div style="display:flex;justify-content:space-between;padding:16px 0;border-top:2px solid #111;margin-bottom:32px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:15px;font-weight:600;color:#111;">總計</td>
                    <td style="text-align:right;font-size:17px;font-weight:700;color:#111;">NT$${totalAmount.toLocaleString()}</td>
                  </tr>
                </table>
              </div>

              <!-- Shipping address -->
              <div style="margin-bottom:32px;">
                <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;margin-bottom:6px;">收件地址</div>
                <div style="font-size:15px;color:#374151;">${addressLine}</div>
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
</html>`
}

export async function sendOrderConfirmation(orderId: string): Promise<void> {
  const resend = new Resend(serverEnv.RESEND_API_KEY)
  const serviceRole = createServiceRoleClient()

  const { data: order } = await serviceRole
    .from("orders")
    .select(
      `order_no, recipient_name, total_amount, shipping_address, zip_code,
       member:member_id(email),
       order_item(quantity, unit_price_snapshot, config_snapshot, product_name_snapshot, product:product_id(name))`,
    )
    .eq("id", orderId)
    .single()

  if (!order) return

  const memberData = order.member
  const email = Array.isArray(memberData)
    ? memberData[0]?.email
    : memberData?.email
  if (!email) return

  const items = (Array.isArray(order.order_item) ? order.order_item : []).map(
    (item) => {
      const productData = item.product
      // 快照優先（下單當下名稱）；join 現值僅供 null 窗口 fallback
      const joinedName = Array.isArray(productData)
        ? productData[0]?.name
        : productData?.name
      const productName = item.product_name_snapshot ?? joinedName ?? "商品"

      const selections = selectionSchema.parse(
        typeof item.config_snapshot === "object" &&
          item.config_snapshot !== null &&
          "selections" in item.config_snapshot
          ? (item.config_snapshot as { selections: unknown }).selections
          : [],
      )

      return {
        productName,
        quantity: item.quantity,
        unitPrice: item.unit_price_snapshot,
        selections,
      }
    },
  )

  const loginUrl = `${serverEnv.NEXT_PUBLIC_SITE_URL}/login`

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `感謝您的訂購 — 訂單 ${order.order_no} 已確認`,
    html: buildEmailHtml({
      orderNo: order.order_no,
      recipientName: order.recipient_name,
      totalAmount: order.total_amount,
      shippingAddress: order.shipping_address,
      zipCode: order.zip_code ?? null,
      loginUrl,
      items,
    }),
  })
  // Resend API 層級錯誤（驗證失敗/超額/退信等）不會 throw，只回傳 { error }；
  // 必須明確轉成 throw，sendOnce（T69）才能正確判斷失敗並標記 failed 以利重試。
  if (error) {
    throw new Error(
      `Resend error: ${error.name} ${error.message} (status ${error.statusCode})`,
    )
  }
}
