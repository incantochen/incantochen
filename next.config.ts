import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { env } from "./src/lib/env";

const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  "form-action 'self' https://payment-stage.ecpay.com.tw https://payment.ecpay.com.tw",
  "frame-ancestors 'none'",
].join("; ");

// next/image 只允許本專案的 Supabase Storage 公開圖（不用 *.supabase.co 萬用字元）；
// hostname 由集中 env 模組（§2 規範）導出，換專案不需改碼。缺 env 時 env.ts 在
// config 載入即 throw（fail fast）；URL 格式錯誤（複製貼上殘留空白等）給明確訊息。
function parseSupabaseHostname(): string {
  try {
    return new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
  } catch {
    throw new Error(
      `Invalid NEXT_PUBLIC_SUPABASE_URL (not a parseable URL): "${env.NEXT_PUBLIC_SUPABASE_URL}"`,
    );
  }
}
const supabaseHostname = parseSupabaseHostname();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHostname,
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  experimental: {
    serverActions: {
      // Server Action body 預設上限 1MB；圖片上傳（T11，單檔上限 5MB）需要放寬
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Content-Security-Policy", value: csp },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  widenClientFileUpload: false,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
