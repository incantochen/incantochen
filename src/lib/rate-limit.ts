import "server-only";

import * as Sentry from "@sentry/nextjs";
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

// T71 ultra review：訪客結帳送出的 email 若命中既有會員，createOrder 會立刻
// 回傳 requiresLogin——這條路徑等於一個未設限流的帳號存在偵測 oracle。比照
// login/actions.ts 的 otpEmailRatelimit／otpIpRatelimit 對等處理，不是宣稱徹底
// 消除 enumeration（回應形狀本身仍會透露資訊），而是限制攻擊者能嘗試的速率。
const checkoutGuestIpRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "10 m"),
  prefix: "ratelimit:checkout-guest-ip",
});

const checkoutGuestTokenRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "10 m"),
  prefix: "ratelimit:checkout-guest-token",
});

export async function checkCheckoutGuestRateLimit(
  ip: string | null,
  guestToken: string | undefined,
): Promise<boolean> {
  const checks = [];
  if (ip) checks.push(checkoutGuestIpRatelimit.limit(ip));
  if (guestToken) checks.push(checkoutGuestTokenRatelimit.limit(guestToken));

  const results = await Promise.all(checks);
  return results.every((r) => r.success);
}

// T93（F-002）：售後申請需登入才能呼叫，key 用 memberId、不做 IP 維度。
// 門檻抓寬鬆——正常客人一張訂單只會申請一次，5 次/10 分鐘已足以擋 script
// 灌爆店家信箱與 support_request 表；同單去重另在 action 層處理。
const supportRequestMemberRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "10 m"),
  prefix: "ratelimit:support-member",
});

// review 修正：沿用下方 safeLimit 的 fail-open 包裝（函式宣告會 hoist，
// 這裡引用早於定義是安全的）——Redis 逾時／中斷不該讓售後申請整段 500，
// 可用性優先於這條路徑的枚舉防護（同 T73 對付款結果頁的取捨）。
export async function checkSupportRequestRateLimit(
  memberId: string,
): Promise<boolean> {
  return safeLimit(supportRequestMemberRatelimit, memberId);
}

// T73 code-review #1：付款結果三頁把限流放進 Promise.all，一旦 Upstash Redis
// 逾時／中斷，.limit() 會 throw、冒泡成 500——付款完成後的 success 頁與 pay
// 頁在 Redis 故障時整段掛掉（改版前這幾頁只依賴 Postgres）。這裡對每個
// .limit() 做 fail-open 包裝：Redis 例外時放行並記 Sentry，付款可用性優先於
// Redis 故障那短暫窗口的枚舉防護（比照 OTP 流程 IP null 時跳過限流的降級）。
async function safeLimit(
  limiter: Ratelimit,
  identifier: string,
): Promise<boolean> {
  try {
    const { success } = await limiter.limit(identifier);
    return success;
  } catch (e) {
    Sentry.captureException(e, {
      tags: { area: "rate-limit", failMode: "fail-open" },
    });
    return true;
  }
}

// T73：/checkout/success、/checkout/pay、/checkout/failed 只憑 URL 上的
// order_no 查訂單，縱深防禦用限流擋暴力枚舉。門檻要容納
// order-status-check.tsx 的合法 poll 迴圈（每 3 秒 refresh、最長 90 秒 ≈
// 30 次請求）。
const orderPageViewIpRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "5 m"),
  prefix: "ratelimit:order-page-view-ip",
});

const orderPageViewOrderRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "5 m"),
  prefix: "ratelimit:order-page-view-order",
});

export async function checkOrderPageViewRateLimit(
  ip: string | null,
  orderNo: string,
): Promise<boolean> {
  const checks = [safeLimit(orderPageViewOrderRatelimit, orderNo)];
  if (ip) checks.push(safeLimit(orderPageViewIpRatelimit, ip));

  const results = await Promise.all(checks);
  return results.every((ok) => ok);
}

// pay 頁建立 payment（createPendingPayment）的第二層防護，門檻抓緊——這個
// 動作不像單純看頁面，一般客人一次結帳只會觸發個位數次。
const orderPayCreateIpRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "5 m"),
  prefix: "ratelimit:order-pay-create-ip",
});

const orderPayCreateOrderRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "5 m"),
  prefix: "ratelimit:order-pay-create-order",
});

export async function checkOrderPayCreateRateLimit(
  ip: string | null,
  orderNo: string,
): Promise<boolean> {
  const checks = [safeLimit(orderPayCreateOrderRatelimit, orderNo)];
  if (ip) checks.push(safeLimit(orderPayCreateIpRatelimit, ip));

  const results = await Promise.all(checks);
  return results.every((ok) => ok);
}
