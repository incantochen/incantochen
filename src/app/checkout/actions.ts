"use server"
import "server-only"

import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { findOrCreateMember } from "@/lib/auth/find-or-create-member"
import { checkoutFormSchema, type CheckoutFormValues } from "@/lib/checkout/schema"

type CreateOrderResult = { ok: false; error: string }

function generateOrderNo(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, "") // YYYYMMDD
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // avoid confusable chars
  let suffix = ""
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)]
  }
  return `INC-${date}-${suffix}`
}

export async function createOrder(
  formData: CheckoutFormValues,
): Promise<CreateOrderResult> {
  // ① Server-side schema validation
  const parsed = checkoutFormSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: "表單資料有誤，請重新填寫" }
  }
  const { email, recipientName, recipientPhone, zipCode, shippingAddress } = parsed.data

  const serviceRole = createServiceRoleClient()
  const cookieStore = await cookies()
  const guestToken = cookieStore.get("guest_token")?.value

  // ② Read cart (service role — RLS blocks all direct reads)
  if (!guestToken) {
    return { ok: false, error: "購物車已空，請重新加入商品" }
  }

  const { data: cart } = await serviceRole
    .from("cart")
    .select("id")
    .eq("guest_token", guestToken)
    .maybeSingle()

  if (!cart) {
    return { ok: false, error: "購物車已空，請重新加入商品" }
  }

  const { data: cartItems } = await serviceRole
    .from("cart_item")
    .select("id, product_id, quantity, unit_price_snapshot, config_snapshot")
    .eq("cart_id", cart.id)

  if (!cartItems || cartItems.length === 0) {
    return { ok: false, error: "購物車已空，請重新加入商品" }
  }

  // ③ Member find-or-create ("結帳即會員")
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let memberId: string

  if (user) {
    // Already logged in — ensure member row exists
    await findOrCreateMember(user.id, user.email ?? email)
    memberId = user.id
  } else {
    // Guest checkout: find or create member by email
    const { data: existingMember } = await serviceRole
      .from("member")
      .select("id")
      .eq("email", email)
      .maybeSingle()

    if (existingMember) {
      memberId = existingMember.id
    } else {
      const { data: newAuthData, error: createError } = await serviceRole.auth.admin.createUser({
        email,
        email_confirm: true,
      })
      if (createError || !newAuthData.user) {
        if (createError?.message?.toLowerCase().includes("already")) {
          return { ok: false, error: "此 Email 已有帳號，請先登入再結帳" }
        }
        return { ok: false, error: "建立會員失敗，請稍後再試" }
      }
      await findOrCreateMember(newAuthData.user.id, email)
      memberId = newAuthData.user.id
    }
  }

  // ④ Calculate amounts
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.unit_price_snapshot * item.quantity,
    0,
  )
  const shippingFee = 0 // T48 暫緩
  const totalAmount = subtotal + shippingFee

  // ⑤⑥ Insert order (retry once on order_no collision)
  // zip_code is added via migration 0003; cast needed until `gen types` is re-run after db push
  async function insertOrder(no: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      member_id: memberId,
      order_no: no,
      status: "pending_payment",
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      zip_code: zipCode,
      shipping_address: shippingAddress,
      subtotal,
      shipping_fee: shippingFee,
      total_amount: totalAmount,
      custom_consent: true,
      consent_at: new Date().toISOString(),
    }
    return serviceRole.from("orders").insert(payload).select("id").single()
  }

  let orderNo = generateOrderNo()
  const firstAttempt = await insertOrder(orderNo)
  let order = firstAttempt.data
  const orderError = firstAttempt.error

  if (orderError || !order) {
    if (orderError?.code === "23505") {
      // order_no collision — retry with a new number
      orderNo = generateOrderNo()
      const retry = await insertOrder(orderNo)
      if (retry.error || !retry.data) {
        return { ok: false, error: "建立訂單失敗，請稍後再試" }
      }
      order = retry.data
    } else {
      return { ok: false, error: "建立訂單失敗，請稍後再試" }
    }
  }

  const orderId = order.id

  // ⑦ Insert order_items (snapshot from cart_item — never recalculate)
  const orderItems = cartItems.map((item) => ({
    order_id: orderId,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price_snapshot: item.unit_price_snapshot,
    config_snapshot: item.config_snapshot,
  }))

  const { error: itemsError } = await serviceRole.from("order_item").insert(orderItems)

  if (itemsError) {
    // Order exists but items failed — return error; admin can clean up orphaned order
    return { ok: false, error: "訂單明細寫入失敗，請聯絡客服（訂單號：" + orderNo + "）" }
  }

  // ⑧ Clear cart (CASCADE deletes cart_items)
  await serviceRole.from("cart").delete().eq("id", cart.id)

  // ⑨ Redirect to success page
  redirect(`/checkout/success?order=${orderNo}&email=${encodeURIComponent(email)}`)
}
