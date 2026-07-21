import type { MetadataRoute } from "next";
import { getSiteUrl, isIndexingEnabled } from "@/lib/seo/site-url";

// force-dynamic：robots 只讀 env，預設會在「建置時」靜態評估、把當下的
// VERCEL_ENV 烤進產物。若在 Vercel 把某 preview 建置 Promote to Production
// （不重建、直接指向凍結產物），正式站 robots.txt 會是 preview 當時的
// Disallow: /（全站禁爬）、零告警。改 runtime 評估杜絕此凍結（metadata route
// 無 inline script，不涉 CSP nonce／白頁問題）。
export const dynamic = "force-dynamic";

// T59：robots.txt。
// - 非 production（preview／本機）全站 Disallow——T82 未分離前 preview 與
//   production 內容相同，放行會被當重複內容收錄（詳見 lib/seo/site-url.ts）。
// - production 擋掉交易／個人流程頁與後台：這些頁對搜尋沒有內容價值，且
//   /checkout、/account 含個人化內容。/ui 為開發用樣式對照頁，保留部署但
//   不給收錄（2026-07-21 拍板：不另做 production 404）。
// - AI 爬蟲（GPTBot／ClaudeBot／PerplexityBot 等）刻意「不」另行封鎖（GEO）：
//   要被 AI 搜尋引用，前提是讓它們讀得到公開商品內容；上列 Disallow 對
//   它們同樣生效。
export default function robots(): MetadataRoute.Robots {
  if (!isIndexingEnabled()) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/account",
        "/admin",
        "/api/",
        "/auth/",
        "/cart",
        "/checkout",
        "/login",
        "/ui",
      ],
    },
    sitemap: new URL("/sitemap.xml", getSiteUrl()).toString(),
  };
}
