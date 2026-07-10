import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { serverEnv } from "@/lib/env.server";

const redis = new Redis({
  url: serverEnv.UPSTASH_REDIS_REST_URL,
  token: serverEnv.UPSTASH_REDIS_REST_TOKEN,
});

// T78 審查發現：@upstash/ratelimit 的 Redis key = [prefix, identifier].join(":")，
// 未指定 prefix 時全部 instance 共用同一個預設值（"@upstash/ratelimit"）。
// otpVerifyIpRatelimit 與 cartWriteIpRatelimit 皆以 IP 為 identifier 且視窗同為
// "1 m"，若不各自給 prefix，兩者會寫入同一個 Redis key、共用同一組計數
// （login 驗證碼嘗試會誤觸發購物車限流，反之亦然）。所有 instance 一律加上
// 專屬 prefix 隔離 key space，不只修新加的兩個。
export const otpIpRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "10 m"),
  prefix: "ratelimit:otp-ip",
});

export const otpEmailRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  prefix: "ratelimit:otp-email",
});

export const otpVerifyIpRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  prefix: "ratelimit:otp-verify-ip",
});

const cartWriteIpRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "1 m"),
  prefix: "ratelimit:cart-write-ip",
});

const cartWriteTokenRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  prefix: "ratelimit:cart-write-token",
});

// 購物車寫入（加入／改量／移除）共用的限流檢查：IP 為 null（無法取得）或
// guestToken 不存在（訪客尚未有 cookie）時跳過對應檢查，避免共用 bucket 誤鎖。
export async function checkCartWriteRateLimit(
  ip: string | null,
  guestToken: string | undefined,
): Promise<boolean> {
  const checks = [];
  if (ip) checks.push(cartWriteIpRatelimit.limit(ip));
  if (guestToken) checks.push(cartWriteTokenRatelimit.limit(guestToken));

  const results = await Promise.all(checks);
  return results.every((r) => r.success);
}
