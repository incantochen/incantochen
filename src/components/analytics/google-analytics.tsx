"use client";

import { useEffect } from "react";
import { getStoredConsent } from "@/lib/analytics/consent";
import { applyAnalyticsConsentGranted, initGtag } from "@/lib/analytics/gtag";

// GA4 載入（T60，Consent Mode v2）。不用 inline <Script> 做 bootstrap——
// 命令全在 effect 內經 initGtag 排入 dataLayer，之後才插入外部 gtag.js：
// 保證佇列順序（consent default → 回訪者還原 → config → gtag.js 開始處理），
// consent 還原共用 getStoredConsent／applyAnalyticsConsentGranted 單一實作，
// 也不需在 script 字串裡插值 gaId。整個 effect 都是「同步外部系統」，
// 無 setState（react-hooks/set-state-in-effect）。
// CSP：production 下此 client chunk 經帶 nonce 的框架 script 載入，
// createElement 插入的 gtag.js 由 strict-dynamic 傳遞信任；nonce 仍顯式帶上。
export function GoogleAnalytics({
  gaId,
  nonce,
}: {
  gaId: string;
  nonce?: string;
}) {
  useEffect(() => {
    initGtag(gaId);
    // 回訪者已同意過 → 還原 granted（新訪客維持 default denied，cookieless ping）
    if (getStoredConsent() === "granted") {
      applyAnalyticsConsentGranted();
    }

    // StrictMode／重掛防重複插入；initGtag 自身也有 window.gtag 既存防重跑
    if (document.querySelector("script[data-ga-loader]") !== null) return;
    const script = document.createElement("script");
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    script.async = true;
    script.setAttribute("data-ga-loader", "");
    if (nonce) script.nonce = nonce;
    document.head.appendChild(script);
  }, [gaId, nonce]);

  return null;
}
