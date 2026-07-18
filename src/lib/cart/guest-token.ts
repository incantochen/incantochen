// guest_token cookie 的單一出處：常數＋cookie 屬性。proxy.ts（middleware
// runtime）與各 server action 都 import 這裡，避免 cookie 名／屬性散落手刻失同步。
// ⚠️ 不加 `import "server-only"`——proxy 在 middleware runtime 執行，server-only
// 會讓它 import 失敗。
export const GUEST_TOKEN_COOKIE = "guest_token";

// 30 天 rolling。效期僅由 addToCart 成功時重設（決策 #14）；proxy 首簽與其他
// 讀取點都不續命。
export const GUEST_TOKEN_MAX_AGE = 60 * 60 * 24 * 30;

export function guestTokenCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: GUEST_TOKEN_MAX_AGE,
  };
}
