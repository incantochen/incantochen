import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";
import {
  GUEST_TOKEN_COOKIE,
  guestTokenCookieOptions,
} from "@/lib/cart/guest-token";

// T97（F-010）：CSP 從 next.config.ts 搬到這裡（單一出處）——nonce 必須
// 每請求新產，next.config 的靜態 headers() 做不到。production 的 script-src
// 改 nonce＋strict-dynamic（Next 會從 request 端的 CSP header 取 nonce 附到
// 框架 inline script 上），不再依賴 unsafe-inline；dev 維持 unsafe-inline／
// unsafe-eval（React dev mode 需要，比照 T58）。其餘 security headers
//（X-Frame-Options／nosniff／HSTS 等）仍留在 next.config.ts。
//
// ⚠️ nonce+strict-dynamic 依賴「每頁動態渲染」：Next 只在動態渲染時把 nonce
// 注入框架 inline script。任一頁若改成靜態（generateStaticParams／
// export const dynamic="force-static"／"use cache"），其 HTML 內的 inline
// script 拿不到本次請求的 nonce、會被 strict-dynamic 全數擋掉而白頁——本專案
// 電商頁本就全動態（價格／庫存／訂單即時），改任何頁為靜態前務必回頭確認這點。
//
// matcher 排除 _next/static、圖檔等靜態資產：這些路徑不經 proxy、拿不到
// 每請求 nonce CSP。⚠️ 但「不執行腳本」是錯的——.svg 被當文件直接開啟
// （<img src> 以外的導覽）可執行內嵌 script，故這些路徑的最小靜態 CSP
// 改由 next.config.ts 的 headers() 補（script-src 'none'），見該檔。
function buildCsp(nonce: string | null): string {
  return [
    "default-src 'self'",
    nonce === null
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    // T60 GA4：img-src／connect-src 放行 GA 量測端點（beacon／像素／gtag.js
    // 的 fetch 傳輸）。script-src 不加 GA host——strict-dynamic 下 host 白名單
    // 本就被忽略，gtag.js 由 google-analytics.tsx（經帶 nonce 的框架 chunk
    // 執行的 createElement）動態插入而獲得信任。
    // *.analytics.google.com 涵蓋 region1.analytics.google.com 等區域 collect 端點。
    "img-src 'self' data: blob: https://*.supabase.co https://www.googletagmanager.com https://*.google-analytics.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com",
    "form-action 'self' https://payment-stage.ecpay.com.tw https://payment.ecpay.com.tw",
    "frame-ancestors 'none'",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  // Set on the request (not the response) so it propagates to Server Components
  // downstream via next/headers' headers() — response.headers only reaches the browser.
  request.headers.set("x-pathname", request.nextUrl.pathname);

  // dev 不產 nonce（unsafe-inline 與 nonce 並存時瀏覽器會忽略 unsafe-inline，
  // 反而擋掉 React dev mode 的 inline script）。
  const nonce =
    process.env.NODE_ENV === "production" ? btoa(crypto.randomUUID()) : null;
  const csp = buildCsp(nonce);

  // CSP 要同時放 request 端（Next 由此解析 nonce 給框架 script）與
  // response 端（瀏覽器執法的是這一份）。
  request.headers.set("content-security-policy", csp);
  if (nonce !== null) {
    request.headers.set("x-nonce", nonce);
  } else {
    // dev 不產 nonce：清掉 client 可能自帶的 x-nonce，別讓外部傳入的值透傳
    // 到 Server Components（下游若信任 x-nonce 會被污染）。production 分支
    // 上面的 set() 已覆蓋，此處只補 dev 缺口。
    request.headers.delete("x-nonce");
  }

  // T133：首次訪客（無 cookie）近乎同時雙擊加車，兩個 addToCart 各自
  // randomUUID() 產不同 token → 兩台 cart、一台對客人消失（uq_cart_guest_token
  // 擋不到不同 token 的兩筆 insert）。修法＝頁面首載就預簽 guest_token，讓
  // 「加入購物袋」永遠不是第一個設 cookie 的動作、消除競爭窗口。
  // request 端先 set：讓同請求下游 Server Component 的 cookies() 立即看得到，
  // 且下面 setAll 以 request 為基底重建 response 時不會弄丟這顆。實際 Set-Cookie
  // 到 browser 的動作放在最終 response 上（見 CSP 旁），理由同 CSP：setAll 可能
  // 已重建 response，太早設會被蓋掉。已有 cookie 則完全不動（不 roll——續命只由
  // addToCart 負責，決策 #14）。
  const existingGuestToken = request.cookies.get(GUEST_TOKEN_COOKIE)?.value;
  const newGuestToken = existingGuestToken ? null : crypto.randomUUID();
  if (newGuestToken !== null) {
    request.cookies.set(GUEST_TOKEN_COOKIE, newGuestToken);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the session token if expired; keeps Supabase Auth cookies current
  // on every request without requiring a manual refresh call from each page.
  // C9：try/catch 包住——getUser 在網路／Supabase 故障時可能 throw，若讓它
  // 冒泡出 proxy，下面設 CSP header 與 return response 都跑不到，該次回應會
  // 完全沒有 CSP（安全 header 退化）。session 沒刷新只是使用者本次未登入態，
  // 遠比整頁無 CSP 安全，故吞錯＋記 Sentry，不 rethrow。
  try {
    await supabase.auth.getUser();
  } catch (e) {
    Sentry.captureException(e, {
      tags: { area: "proxy-auth", failMode: "fail-soft" },
    });
    // proxy 非 route handler、無平台 auto-flush 兜底；捕捉後立即 return，
    // serverless 可能在事件送出前凍結——主動 flush 確保這發告警離開
    //（§6 serverless 禁 fire-and-forget，比照 get-cart-count 的 fail-soft 路徑）。
    await Sentry.flush(2000);
  }

  // 放在 getUser() 之後：上面的 setAll 會重建 response，太早設會被蓋掉。
  response.headers.set("Content-Security-Policy", csp);

  // T133：預簽 guest_token 也放這裡（同 CSP 的理由——setAll 可能已重建 response）。
  // 只在本次請求首簽時 set；已有 cookie 者 newGuestToken 為 null、完全不動。
  if (newGuestToken !== null) {
    response.cookies.set(
      GUEST_TOKEN_COOKIE,
      newGuestToken,
      guestTokenCookieOptions(),
    );
  }

  return response;
}

export const config = {
  matcher: [
    // 副檔名清單須與 next.config.ts 的靜態 CSP source 對齊（含 ico|avif）：
    // 這些路徑一律走 next.config 的最小靜態 CSP、不經 proxy，避免同一回應
    // 同時被 proxy 的 nonce CSP 與 next.config 的 static CSP 各設一份（交集），
    // 也省下對圖檔白呼叫一次 getUser()。
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|avif)$).*)",
  ],
};
