import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { env } from "@/lib/env"

// T97（F-010）：CSP 從 next.config.ts 搬到這裡（單一出處）——nonce 必須
// 每請求新產，next.config 的靜態 headers() 做不到。production 的 script-src
// 改 nonce＋strict-dynamic（Next 會從 request 端的 CSP header 取 nonce 附到
// 框架 inline script 上），不再依賴 unsafe-inline；dev 維持 unsafe-inline／
// unsafe-eval（React dev mode 需要，比照 T58）。其餘 security headers
//（X-Frame-Options／nosniff／HSTS 等）仍留在 next.config.ts。
// matcher 已排除 _next/static、圖檔等靜態資產——CSP 只需覆蓋 document
// 回應，靜態資產不執行腳本，現行 matcher 範圍足夠。
function buildCsp(nonce: string | null): string {
  return [
    "default-src 'self'",
    nonce === null
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
    "form-action 'self' https://payment-stage.ecpay.com.tw https://payment.ecpay.com.tw",
    "frame-ancestors 'none'",
  ].join("; ")
}

export async function proxy(request: NextRequest) {
  // Set on the request (not the response) so it propagates to Server Components
  // downstream via next/headers' headers() — response.headers only reaches the browser.
  request.headers.set("x-pathname", request.nextUrl.pathname)

  // dev 不產 nonce（unsafe-inline 與 nonce 並存時瀏覽器會忽略 unsafe-inline，
  // 反而擋掉 React dev mode 的 inline script）。
  const nonce =
    process.env.NODE_ENV === "production" ? btoa(crypto.randomUUID()) : null
  const csp = buildCsp(nonce)

  // CSP 要同時放 request 端（Next 由此解析 nonce 給框架 script）與
  // response 端（瀏覽器執法的是這一份）。
  request.headers.set("content-security-policy", csp)
  if (nonce !== null) {
    request.headers.set("x-nonce", nonce)
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // Refreshes the session token if expired; keeps Supabase Auth cookies current
  // on every request without requiring a manual refresh call from each page.
  await supabase.auth.getUser()

  // 放在 getUser() 之後：上面的 setAll 會重建 response，太早設會被蓋掉。
  response.headers.set("Content-Security-Policy", csp)

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
