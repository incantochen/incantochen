import "server-only"
import { Resend } from "resend"
import { serverEnv } from "@/lib/env.server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { escapeHtml } from "@/lib/email/escape-html"
import {
  FROM_EMAIL,
  renderCustomerEmailShell,
  unwrapOne,
} from "@/lib/email/email-shell"
import { parseTracking } from "@/lib/order/shipping-tracking"

function buildEmailHtml(params: {
  orderNo: string
  recipientName: string
  trackingNo: string
  loginUrl: string
}): string {
  const { orderNo, recipientName, trackingNo, loginUrl } = params
  const safeRecipientName = escapeHtml(recipientName)

  const { isPickup, pickupNote } = parseTracking(trackingNo)
  const safeTrackingNo = escapeHtml(trackingNo)
  const safePickupNote = escapeHtml(pickupNote)

  const bodyText = isPickup
    ? "您訂購的商品已準備完成，我們將盡快與您聯繫安排面交時間與地點。"
    : "您訂購的商品已交由物流出貨，請留意簽收。"

  const trackingSection = isPickup
    ? pickupNote
      ? `
              <div style="background:#f9f7f4;border-radius:4px;padding:16px 20px;margin-bottom:32px;">
                <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">面交備註</div>
                <div style="font-size:15px;color:#374151;">${safePickupNote}</div>
              </div>`
      : ""
    : `
              <div style="background:#f9f7f4;border-radius:4px;padding:16px 20px;margin-bottom:32px;">
                <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">物流單號</div>
                <div style="font-family:monospace;font-size:16px;font-weight:600;color:#111;">${safeTrackingNo}</div>
              </div>`

  const bodyHtml = `
              <p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">
                ${bodyText}
              </p>

              <!-- Order number -->
              <div style="background:#f9f7f4;border-radius:4px;padding:16px 20px;margin-bottom:16px;">
                <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">訂單號碼</div>
                <div style="font-family:monospace;font-size:16px;font-weight:600;color:#111;">${orderNo}</div>
              </div>
${trackingSection}`

  return renderCustomerEmailShell({
    title: "訂單已出貨",
    eyebrow: isPickup ? "可安排面交" : "已出貨",
    heading: isPickup
      ? `您的訂單已可安排面交，${safeRecipientName}`
      : `您的訂單已寄出，${safeRecipientName}`,
    bodyHtml,
    loginUrl,
  })
}

export async function sendOrderShippedNotification(
  orderId: string,
): Promise<void> {
  const resend = new Resend(serverEnv.RESEND_API_KEY)
  const serviceRole = createServiceRoleClient()

  const { data: order, error: queryError } = await serviceRole
    .from("orders")
    .select("order_no, recipient_name, tracking_no, member:member_id(email)")
    .eq("id", orderId)
    .single()

  // PGRST116＝查無此列（理論上不會發生，orderId 來自已建立的訂單）：視為
  // 沒東西可寄，安靜跳過。其餘錯誤（timeout／連線池耗盡等）代表「查詢失敗」，
  // 若不分辨會被誤判成「訂單不存在」而靜默略過，必須 throw 讓 sendOnce 標記
  // failed 以利之後重試（見 CLAUDE.md §6 防禦性寫法通則）。
  if (queryError) {
    if (queryError.code === "PGRST116") return
    throw new Error(`sendOrderShippedNotification query failed: ${queryError.message}`)
  }
  if (!order.tracking_no) return

  const email = unwrapOne(order.member)?.email
  if (!email) return

  const loginUrl = `${serverEnv.NEXT_PUBLIC_SITE_URL}/login`

  const { isPickup } = parseTracking(order.tracking_no)
  const subject = isPickup
    ? `您的訂單已可安排面交 — 訂單 ${order.order_no}`
    : `您的訂單已出貨 — 訂單 ${order.order_no}`

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject,
    html: buildEmailHtml({
      orderNo: order.order_no,
      recipientName: order.recipient_name,
      trackingNo: order.tracking_no,
      loginUrl,
    }),
  })
  // Resend API 層級錯誤（驗證失敗/超額/退信等）不會 throw，只回傳 { error }；
  // 必須明確轉成 throw，呼叫端才能判斷失敗（見 shipOrder：await＋try/catch 吞錯，
  // 出貨這件事本身已經成功寫入 DB，寄信只是 best-effort 通知）。
  if (error) {
    throw new Error(
      `Resend error: ${error.name} ${error.message} (status ${error.statusCode})`,
    )
  }
}
