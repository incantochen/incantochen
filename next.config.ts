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
  typescript: {
    // 型別檢查單一出處＝CI 的 `pnpm typecheck`（next typegen + tsc --noEmit，
    // 涵蓋含測試檔的全 repo；check 為分支保護必要 gate）。preview build 與
    // PR CI 檢查同一個 commit，故 preview 關掉 build 期型別檢查消除重複、
    // 加快 preview；production build（master 部署，含直推 master 的 docs
    // commit 路徑）與本機 build 保留檢查，作為 deploy 前最後防線——
    // 直推 master 不等 CI，這裡是該路徑唯一的型別防線，不可一併關掉。
    ignoreBuildErrors: process.env.VERCEL_ENV === "preview",
  },
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
      {
        // T97 補洞：proxy matcher 排除圖檔／favicon（拿不到每請求 nonce CSP），
        // 這些路徑原本零 CSP。.svg 被當文件直接開啟時可執行內嵌 script，故給
        // 一份最小靜態 CSP（script-src 'none'）擋掉。刻意獨立於上面的 "/(.*)"
        // ——若把 CSP 塞進 "/(.*)" 會連 document 回應也蓋一份靜態 CSP，與 proxy
        // 的 nonce 版被瀏覽器取交集而廢掉 nonce+strict-dynamic。此 source 只命中
        // 圖檔副檔名，而這些路徑本就不經 proxy，不衝突。
        source: "/(.*)\\.(svg|png|jpg|jpeg|gif|webp|ico|avif)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'none'; frame-ancestors 'none'",
          },
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
