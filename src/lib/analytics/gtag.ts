// GA4 事件包裝（T60）。所有呼叫都先檢查 window.gtag 存在——
// NEXT_PUBLIC_GA_ID 未設（dev／preview）或 gtag 尚未 bootstrap 時全部 no-op，
// 呼叫端不需要自己判斷 analytics 是否啟用。

import { CONSENT_COOKIE } from "@/lib/analytics/consent";

// 三個漏斗事件共用的 GA4 item 結構（單一出處，避免三份事件各自漂移）
export type GaItem = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
};

const CURRENCY = "TWD";

function callGtag(...args: unknown[]) {
  if (typeof window === "undefined" || typeof window.gtag !== "function")
    return;
  window.gtag(...args);
}

// gtag bootstrap 腳本字串（由 GoogleAnalytics 以帶 nonce 的 inline <script>
// 於 server 端渲染、parse 時「同步」執行——早於 React hydration 與所有 tracker
// 的 effect，故 PurchaseTracker／BeginCheckoutTracker 觸發時 window.gtag 必已
// 存在（不再 no-op 而漏送）。這正是 Google 官方 snippet 放 <head> 的理由。
//
// 命令順序（gtag.js 依 dataLayer FIFO 處理）：
//   consent default(全 denied) → 回訪者 grant 還原 → js → config
// grant 刻意在 config「之前」：config 會觸發自動 page_view，若 grant 落在其後，
// 回訪已同意者的落地 page_view 會以 cookieless 送出、失去 _ga 連續性。
// gaId 已由 AnalyticsRoot 以 /^G-[A-Z0-9]+$/i 驗過、CONSENT_COOKIE 為常數，
// 插值無注入面；nonce 由 <script> 標籤帶上，過 CSP nonce+strict-dynamic。
export function buildGtagBootstrap(gaId: string): string {
  return [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments);}",
    "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'});",
    `try{if(document.cookie.split('; ').indexOf('${CONSENT_COOKIE}=granted')!==-1)gtag('consent','update',{analytics_storage:'granted'});}catch(e){}`,
    "gtag('js',new Date());",
    `gtag('config','${gaId}');`,
  ].join("");
}

// 同意後的 consent update 單一出處：banner「接受」與回訪者還原都走這裡。
// 本站無廣告投放，只 grant analytics_storage，ad_* 維持 denied（隱私保守）。
export function applyAnalyticsConsentGranted() {
  callGtag("consent", "update", { analytics_storage: "granted" });
}

export function trackEvent(name: string, params: Record<string, unknown>) {
  callGtag("event", name, params);
}

export function trackAddToCart(input: { value: number; items: GaItem[] }) {
  trackEvent("add_to_cart", { currency: CURRENCY, ...input });
}

export function trackBeginCheckout(input: { value: number; items: GaItem[] }) {
  trackEvent("begin_checkout", { currency: CURRENCY, ...input });
}

export function trackPurchase(input: {
  transactionId: string;
  value: number;
  items: GaItem[];
}) {
  const { transactionId, ...rest } = input;
  trackEvent("purchase", {
    transaction_id: transactionId,
    currency: CURRENCY,
    ...rest,
  });
}
