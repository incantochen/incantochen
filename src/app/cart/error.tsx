"use client";

import { SystemBusyErrorBoundary } from "@/components/system-busy-error-boundary";

// T95（F-008）：getCart 對 DB 暫時性故障改 throw，由這個 error boundary
// 接住顯示系統忙碌——不可讓故障渲染成「購物袋是空的」誤報。
export default function CartError({ reset }: { reset: () => void }) {
  return <SystemBusyErrorBoundary reset={reset} />;
}
