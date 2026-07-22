"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  getStoredConsent,
  setStoredConsent,
  subscribeConsent,
} from "@/lib/analytics/consent";
import { applyAnalyticsConsentGranted } from "@/lib/analytics/gtag";

// SSR／hydration 期間回傳 "unknown"（不顯示），client 端才讀 cookie 決定——
// 已同意／已拒絕的回訪者不會看到 banner 閃現。
function getConsentSnapshot() {
  return getStoredConsent() ?? "none";
}

function getServerSnapshot() {
  return "unknown" as const;
}

// Cookie 同意 banner（T60）。只在尚未做過選擇時顯示；文案為一般 cookie
// 說明（法律用詞以律師審定版為準，見 CLAUDE.md §8）。深底 band 比照
// footer（bg-primary），深底 CTA 配色依 button.tsx 註解：gold 主、ghost 次。
export function CookieConsentBanner() {
  const consent = useSyncExternalStore(
    subscribeConsent,
    getConsentSnapshot,
    getServerSnapshot,
  );

  if (consent !== "none") return null;

  function handleAccept() {
    setStoredConsent("granted"); // store notify → banner 收合
    applyAnalyticsConsentGranted();
  }

  function handleDecline() {
    setStoredConsent("denied");
  }

  return (
    <div
      role="region"
      aria-label="Cookie 同意"
      className="fixed inset-x-0 bottom-0 z-50 bg-primary text-primary-foreground/90"
    >
      <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm">
          本網站使用 Cookie
          分析流量以改善服務；在您同意前，僅使用不含個人識別的必要功能。詳見
          <Link
            href="/privacy"
            className="underline underline-offset-2 hover:text-primary-foreground"
          >
            隱私權政策
          </Link>
          。
        </p>
        <div className="flex shrink-0 gap-2.5">
          <Button variant="ghost" size="sm" onClick={handleDecline}>
            僅必要 Cookie
          </Button>
          <Button variant="gold" size="sm" onClick={handleAccept}>
            接受
          </Button>
        </div>
      </div>
    </div>
  );
}
