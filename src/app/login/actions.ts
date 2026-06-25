"use server"

import { createClient } from "@/lib/supabase/server"
import { findOrCreateMember } from "@/lib/auth/find-or-create-member"

type ActionResult = { ok: true } | { ok: false; error: string }

export async function requestOtp(email: string): Promise<ActionResult> {
  if (!email || !email.includes("@")) {
    return { ok: false, error: "請輸入有效的 Email" }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({ email })

  if (error) {
    return { ok: false, error: "寄送失敗，請稍後再試" }
  }

  return { ok: true }
}

export async function verifyOtpCode(email: string, token: string): Promise<ActionResult> {
  if (!/^\d{4,10}$/.test(token)) {
    return { ok: false, error: "請輸入驗證碼" }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  })

  if (error || !data.user) {
    return { ok: false, error: "驗證碼錯誤或已過期" }
  }

  await findOrCreateMember(data.user.id, data.user.email ?? email)

  return { ok: true }
}
