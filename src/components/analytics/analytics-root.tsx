import { headers } from "next/headers";
import { gaId } from "@/lib/env";
import { GoogleAnalytics } from "@/components/analytics/google-analytics";
import { CookieConsentBanner } from "@/components/analytics/cookie-consent-banner";

// analytics 掛載點（T60，async server component，掛在 root layout）。
// NEXT_PUBLIC_GA_ID 未設或格式不對 → 全關（GA、banner 都不渲染），
// dev／preview 無 ID 照常跑。nonce 由 proxy.ts 經 x-nonce request header
// 傳入（production 才有；dev CSP 走 unsafe-inline、無 nonce）。
export async function AnalyticsRoot() {
  if (!gaId || !/^G-[A-Z0-9]+$/i.test(gaId)) return null;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <GoogleAnalytics gaId={gaId} nonce={nonce} />
      <CookieConsentBanner />
    </>
  );
}
