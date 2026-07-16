"use client";

import { SystemBusyErrorBoundary } from "@/components/system-busy-error-boundary";

// T95 review 修正：同 /checkout 缺口——admin 代客建單頁也呼叫 getCart()，
// 同樣需要 route-scoped error boundary；admin 素色版型（CLAUDE.md §3）。
export default function AdminOrdersCheckoutError({
  reset,
}: {
  reset: () => void;
}) {
  return <SystemBusyErrorBoundary reset={reset} variant="admin" />;
}
