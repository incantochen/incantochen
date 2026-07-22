// GA4 gtag 全域宣告（T60）。gtag 由 GoogleAnalytics 元件 bootstrap 時掛上；
// 未設 NEXT_PUBLIC_GA_ID 的環境兩者皆為 undefined，呼叫端一律先做 typeof 檢查。
export {};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}
