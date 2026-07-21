import "server-only";
import { serverEnv } from "@/lib/env.server";

// SEO 用「網站正式網址」與「是否開放搜尋引擎索引」的單一出處。
//
// 正式網址沿用既有 NEXT_PUBLIC_SITE_URL（金流回拋、email 內連結亦用同一顆，
// 見 env.server.ts）：metadataBase／sitemap／robots／canonical 全跟著它走，
// T35 換正式網域只改 Vercel env 一處。

/** metadataBase／sitemap／robots／canonical 共用的網站根 URL。 */
export function getSiteUrl(): URL {
  return new URL(serverEnv.NEXT_PUBLIC_SITE_URL);
}

// 只有 Vercel production 才開放索引。T82（環境變數分離）未完成前，preview
// 與 production 共用同一組 env——若不擋，preview 部署會被搜尋引擎當成
// production 的重複內容收錄。故 robots.txt 與全站 metadata robots 都依此
// 判斷；preview／本機一律 noindex＋robots.txt 全禁。
export function isIndexingEnabled(): boolean {
  return process.env.VERCEL_ENV === "production";
}
