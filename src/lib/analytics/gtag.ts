// GA4 事件包裝（T60）。所有呼叫都先檢查 window.gtag 存在——
// NEXT_PUBLIC_GA_ID 未設（dev／preview）或 gtag 尚未 bootstrap 時全部 no-op，
// 呼叫端不需要自己判斷 analytics 是否啟用。

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

// gtag bootstrap：掛 window.gtag ＋ Consent Mode v2 預設全 denied ＋ config。
// 由 GoogleAnalytics 元件在載入 gtag.js「之前」呼叫——命令先排進 dataLayer，
// gtag.js 載入後依序處理，保證 consent default 先於 config 生效。
// ⚠️ gtag.js 只認 dataLayer 裡的 Arguments 物件，push 一般陣列命令不會生效，
// 故這裡必須用 function ＋ arguments，不能用 arrow ＋ rest spread。
export function initGtag(gaId: string) {
  if (typeof window === "undefined" || typeof window.gtag === "function")
    return;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
  window.gtag("js", new Date());
  window.gtag("config", gaId);
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
