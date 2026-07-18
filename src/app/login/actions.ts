"use server";

import { headers } from "next/headers";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
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

  // T81：登入成功後把訪客購物車併入會員名下。mergeGuestCartOnLogin 內部已是
  // fail-soft（吞錯記 Sentry 不 throw），這裡再加一層 call-site 兜底：即使日後
  // 併車契約改變而意外 throw，也絕不能讓已成功的登入退化成失敗——車與 cookie
  // 都還在，下次登入／加車會自我修復。
  try {
    await mergeGuestCartOnLogin(data.user.id);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { area: "cart-merge", failMode: "fail-soft" },
    });
    await Sentry.flush(2000);
  }

  return { ok: true };
}
