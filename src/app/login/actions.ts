"use server"

import { headers } from "next/headers"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { findOrCreateMember } from "@/lib/auth/find-or-create-member"
import { otpEmailRatelimit, otpIpRatelimit, otpVerifyIpRatelimit } from "@/lib/rate-limit"

type ActionResult = { ok: true } | { ok: false; error: string }

const emailSchema = z.string().email()

function getIp(headersList: Awaited<ReturnType<typeof headers>>): string | null {
  return (
    headersList.get("cf-connecting-ip") ??
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    null
  )
}

export async function requestOtp(email: string): Promise<ActionResult> {
  email = email.trim().toLowerCase()

  if (!emailSchema.safeParse(email).success) {
    return { ok: false, error: "請輸入有效的 Email" }
  }

  const headersList = await headers()
  const ip = getIp(headersList)

  const checks = [otpEmailRatelimit.limit(email)]
  if (ip) checks.push(otpIpRatelimit.limit(ip))

  const results = await Promise.all(checks)
  if (results.some((r) => !r.success)) {
    return { ok: false, error: "請求太頻繁，請稍後再試" }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({ email })

  if (error) {
    return { ok: false, error: "寄送失敗，請稍後再試" }
  }

  return { ok: true }
}

export async function verifyOtpCode(email: string, token: string): Promise<ActionResult> {
  email = email.trim().toLowerCase()

  if (!/^\d{4,10}$/.test(token)) {
    return { ok: false, error: "請輸入驗證碼" }
  }

  const headersList = await headers()
  const ip = getIp(headersList)

  if (ip) {
    const result = await otpVerifyIpRatelimit.limit(ip)
    if (!result.success) {
      return { ok: false, error: "請求太頻繁，請稍後再試" }
    }
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
