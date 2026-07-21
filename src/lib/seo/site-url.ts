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
//
// 直讀 process.env.VERCEL_ENV（非走 env.server 的 required()）是刻意的：這是
// Vercel 平台注入的系統變數、不在 .env、缺值＝「非 production」屬正常語意，
// 無法用 required() 表達（比照 instrumentation.ts／next.config.ts 的 bootstrap
// 層讀法）。⚠️ 取捨：若上線環境改為非 Vercel（如未來 module-commerce 自架
// next start），VERCEL_ENV 不存在會讓正式站「靜默」全站 noindex——這類故障
// 零錯誤零告警。緩解＝上線平台鎖定 Vercel（T121 決策），且 T38 上線檢查表
// 必項「以 securityheaders／Search Console 掃 production URL 確認可索引」會
// 攔到；真要脫離 Vercel 時，此處改用明示的索引開關 env。
export function isIndexingEnabled(): boolean {
  return process.env.VERCEL_ENV === "production";
}
