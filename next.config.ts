import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { env } from "./src/lib/env";
import { MAX_IMAGE_FILE_SIZE } from "./src/lib/storage/constants";

// T97：CSP 已搬到 src/proxy.ts（nonce 需每請求新產，靜態 headers() 做不到），
// 這裡不可再設 Content-Security-Policy——瀏覽器對多個 CSP header 取交集，
// 會把 proxy 的 nonce 版廢掉。其餘 security headers 仍由本檔負責。

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
      // Server Action body 預設上限 1MB；圖片上傳需要放寬——直接由檔案上限
      // 推導（+1MB 給 FormData 開銷），日後調 MAX_IMAGE_FILE_SIZE 不會漏改這裡
      bodySizeLimit: `${Math.ceil(MAX_IMAGE_FILE_SIZE / (1024 * 1024)) + 1}mb`,
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
