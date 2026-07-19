"use client";

import Link from "next/link";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// T62：全站 500 error boundary（root segment）。接住未被 route-scoped
// boundary 攔下的未預期錯誤，回報 Sentry（比照 global-error.tsx／T37 監控意圖），
// 渲染品牌一致的錯誤頁。global-error.tsx 僅在 root layout 本身炸掉時才接手，
// 兩者不重疊。品牌 token 對齊 SystemBusyCard／brand-guide。
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-20 text-center">
      <p className="eyebrow mb-5">SOMETHING WENT WRONG</p>
      <h1 className="font-head text-3xl text-ink sm:text-4xl">系統忙碌中</h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-ash">
        暫時無法載入內容，請稍後再試一次。
      </p>
      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="inline-block rounded-[2px] bg-primary px-8 py-3 text-[11.5px] font-medium uppercase tracking-[0.2em] text-primary-foreground transition-colors hover:bg-primary/90"
        >
          重新整理
        </button>
        <Link
          href="/"
          className="inline-block rounded-[2px] border border-primary px-8 py-3 text-[11.5px] font-medium uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          返回首頁
        </Link>
      </div>
    </div>
  );
}
