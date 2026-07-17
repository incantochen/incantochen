import "server-only";

import { createHmac } from "crypto";
import { serverEnv } from "@/lib/env.server";
import { timingSafeEqualStrings } from "@/lib/timing-safe-equal";

// T73：/checkout/success、/checkout/pay、/checkout/failed 三頁只憑 URL 上的
// order_no 查訂單，本身沒有擁有權欄位可查（訂單成立後 cart 可能已被 T75
// 保留機制以外的流程清空），所以用無狀態 HMAC 簽章證明「這個瀏覽器剛結帳
// 過這筆訂單」，不寫 DB、不查表。
export const ORDER_ACCESS_COOKIE = "order_access_token";

const ORDER_ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 2; // 2 小時

// 簽章涵蓋 orderNo 與核發時間，效期由伺服器端驗證強制執行——單靠 cookie
// 的 maxAge（client-side 屬性）的話，token 字串一旦外流（log／MITM／共用
// 電腦殘留），拿去手動組 Cookie header 重放會永遠有效，因為驗證端從未檢查
// 核發時間。
function sign(orderNo: string, issuedAt: number): string {
  return createHmac("sha256", serverEnv.ORDER_ACCESS_TOKEN_SECRET)
    .update(`${orderNo}:${issuedAt}`)
    .digest("base64url");
}

export function orderAccessCookieOptions(orderNo: string) {
  const issuedAt = Date.now();
  return {
    name: ORDER_ACCESS_COOKIE,
    value: `${issuedAt}.${sign(orderNo, issuedAt)}`,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/checkout",
    maxAge: ORDER_ACCESS_COOKIE_MAX_AGE_SECONDS,
  };
}

// 簽章比對走共用 timingSafeEqualStrings（sha256 digest 常數時間比對），
// 與 ecpay/check-mac-value.ts、cron/require-cron-auth.ts 同一出處。
export function isValidOrderAccessCookie(
  cookieValue: string | undefined,
  orderNo: string,
): boolean {
  if (!cookieValue) return false;
  const separatorIndex = cookieValue.indexOf(".");
  if (separatorIndex === -1) return false;

  const issuedAt = Number(cookieValue.slice(0, separatorIndex));
  // §6：numeric 比對前先 Number()＋Number.isFinite() 防 NaN——偽造或截斷的
  // cookie 值不能讓 NaN 比較悄悄通過。
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > ORDER_ACCESS_COOKIE_MAX_AGE_SECONDS * 1000) {
    return false;
  }

  const signature = cookieValue.slice(separatorIndex + 1);
  return timingSafeEqualStrings(sign(orderNo, issuedAt), signature);
}

export type OrderOwnership = {
  ownerBySession: boolean;
  ownerByCookie: boolean;
  // cookie 存在但簽章跟這筆 order_no 不符（且不是本人登入帳號的訂單）——
  // 代表這個瀏覽器剛結帳過別筆訂單，卻來戳這筆。唯一能安全判定「不該讓它
  // 繼續」的訊號；cookie 缺席時一律 false（T111 情境無法判斷，不擋）。
  cookiePresentButWrong: boolean;
};

export function resolveOrderOwnership(
  cookieToken: string | undefined,
  order: { order_no: string; member_id: string | null },
  user: { id: string } | null,
): OrderOwnership {
  const ownerBySession = !!user && user.id === order.member_id;
  const ownerByCookie = isValidOrderAccessCookie(cookieToken, order.order_no);
  const cookiePresentButWrong =
    cookieToken !== undefined && !ownerByCookie && !ownerBySession;
  return { ownerBySession, ownerByCookie, cookiePresentButWrong };
}
