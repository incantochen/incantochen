"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { findOrCreateMember } from "@/lib/auth/find-or-create-member";
import { mergeGuestCartOnLogin } from "@/lib/cart/merge-guest-cart";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import {
  otpEmailRatelimit,
  otpIpRatelimit,
  otpVerifyIpRatelimit,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";

type ActionResult = { ok: true } | { ok: false; error: string };

const emailSchema = z.string().email();

export async function requestOtp(email: string): Promise<ActionResult> {
  email = normalizeEmail(email);

  if (!emailSchema.safeParse(email).success) {
    return { ok: false, error: "請輸入有效的 Email" };
  }

  const headersList = await headers();
  const ip = getClientIp(headersList);

  const checks = [otpEmailRatelimit.limit(email)];
  if (ip) checks.push(otpIpRatelimit.limit(ip));

  const results = await Promise.all(checks);
  if (results.some((r) => !r.success)) {
    return { ok: false, error: "請求太頻繁，請稍後再試" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email });

  if (error) {
    return { ok: false, error: "寄送失敗，請稍後再試" };
  }

  return { ok: true };
}

export async function verifyOtpCode(
  email: string,
  token: string,
): Promise<ActionResult> {
  email = normalizeEmail(email);

  if (!/^\d{4,10}$/.test(token)) {
    return { ok: false, error: "請輸入驗證碼" };
  }

  const headersList = await headers();
  const ip = getClientIp(headersList);

  if (ip) {
    const result = await otpVerifyIpRatelimit.limit(ip);
    if (!result.success) {
      return { ok: false, error: "請求太頻繁，請稍後再試" };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error || !data.user) {
    return { ok: false, error: "驗證碼錯誤或已過期" };
  }

  await findOrCreateMember(data.user.id, data.user.email ?? email);

  // T81：登入成功後把訪客購物車併入會員名下。fail-soft（吞錯記 Sentry、絕不
  // throw）是 mergeGuestCartOnLogin 的結構保證（try 包住整個函式體），呼叫端
  // 直接 await——登入不因併車失敗而中止，車與 cookie 都還在，下次登入／加車
  // 會自我修復。
  await mergeGuestCartOnLogin(data.user.id);

  return { ok: true };
}
