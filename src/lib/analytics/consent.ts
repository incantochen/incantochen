// cookie_consent cookie 的單一出處：常數＋讀寫（比照 guest-token.ts 慣例）。
// ⚠️ 與 guest_token 不同，這顆刻意「非 httpOnly」——同意狀態由前端讀寫
// （banner 顯示判斷＋Consent Mode update），不經 server。
export const CONSENT_COOKIE = "cookie_consent";

// 1 年。同意屬使用者明示選擇，效期內不重複打擾。
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;

export type ConsentValue = "granted" | "denied";

export function getStoredConsent(): ConsentValue | null {
  if (typeof document === "undefined") return null;
  const entry = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  const value = entry?.slice(CONSENT_COOKIE.length + 1);
  return value === "granted" || value === "denied" ? value : null;
}

// 同意狀態的最小 external store：banner 用 useSyncExternalStore 訂閱，
// 避免「effect 內 setState」的 hydration 慣用法（react-hooks/set-state-in-effect）。
// cookie 只會被本站自己的 setStoredConsent 改動，故 notify 只需在寫入時觸發。
const listeners = new Set<() => void>();

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setStoredConsent(value: ConsentValue) {
  if (typeof document === "undefined") return;
  // 以 protocol 判斷 Secure（涵蓋 production 與 https preview；本機 http 不加）
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  listeners.forEach((listener) => listener());
}
