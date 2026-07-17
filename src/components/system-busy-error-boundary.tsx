"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { SystemBusyCard } from "@/components/system-busy-card";

// T95（F-008）review 修正：getCart() 對 DB 暫時性故障改 throw 後，凡是呼叫
// getCart() 的頁面都需要一個 route-scoped error boundary 接住，否則會掉到
// global-error.tsx 把整個 <html> 卸載——比修復前的行為更糟。此元件供
// /cart、/checkout、/admin/orders/checkout、/account 共用（variant 對齊
// CLAUDE.md §3：admin 用 gray 素色、前台用品牌 token）。
export function SystemBusyErrorBoundary({
  reset,
  variant = "brand",
  message = "暫時無法讀取購物袋內容，請稍候片刻再試一次",
}: {
  reset: () => void;
  variant?: "brand" | "admin";
  message?: string;
}) {
  // Next 的 error boundary reset() 只重新掛載 boundary、不重抓 server 資料，
  // 對「server component 讀 DB 失敗」的情境按了等於沒按（同一份錯誤又渲染
  // 出來）。startTransition 包 router.refresh() 才會重跑 server 端資料抓取，
  // 再 reset() 清掉錯誤狀態。
  const router = useRouter();
  const onRetry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  return (
    <SystemBusyCard variant={variant} message={message} onRetry={onRetry} />
  );
}
