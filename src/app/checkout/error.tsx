"use client";

import { SystemBusyErrorBoundary } from "@/components/system-busy-error-boundary";

// T95 review 修正：/checkout 呼叫 getCart()（現在對 DB 錯誤會 throw），
// 原本沒有 route-scoped error boundary、會掉到 global-error.tsx 整個
// <html> 卸載——比修復前（誤報購物車已空）更糟。
export default function CheckoutError({ reset }: { reset: () => void }) {
  return <SystemBusyErrorBoundary reset={reset} />;
}
