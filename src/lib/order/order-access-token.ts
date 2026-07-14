import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { serverEnv } from "@/lib/env.server";

// T73：/checkout/success、/checkout/pay、/checkout/failed 三頁只憑 URL 上的
// order_no 查訂單，本身沒有擁有權欄位可查（訂單成立後 cart 可能已被 T75
// 保留機制以外的流程清空），所以用無狀態 HMAC 簽章證明「這個瀏覽器剛結帳
// 過這筆訂單」，不寫 DB、不查表。
export const ORDER_ACCESS_COOKIE = "order_access_token";

const ORDER_ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 2; // 2 小時

function sign(orderNo: string): string {
  return createHmac("sha256", serverEnv.ORDER_ACCESS_TOKEN_SECRET)
    .update(orderNo)
    .digest("base64url");
}

export function orderAccessCookieOptions(orderNo: string) {
  return {
    name: ORDER_ACCESS_COOKIE,
    value: sign(orderNo),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/checkout",
    maxAge: ORDER_ACCESS_COOKIE_MAX_AGE_SECONDS,
  };
}

// 比照 ecpay/check-mac-value.ts 的 verifyCheckMacValue：timingSafeEqual 對長度
// 不同的 buffer 會直接 throw，先做長度檢查再進常數時間比對。
export function isValidOrderAccessCookie(
  cookieValue: string | undefined,
  orderNo: string,
): boolean {
  if (!cookieValue) return false;
  const expected = Buffer.from(sign(orderNo));
  const actual = Buffer.from(cookieValue);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
