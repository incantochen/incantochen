"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { findOrCreateMember } from "@/lib/auth/find-or-create-member";
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

  return { ok: true };
}
