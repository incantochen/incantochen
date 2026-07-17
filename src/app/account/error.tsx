"use client";

import { SystemBusyErrorBoundary } from "@/components/system-busy-error-boundary";

// 帳戶區（/account/orders 列表、訂單詳情、售後頁）的 server component 查 DB
// 失敗時改 throw（§6：查詢失敗 ≠ 查無資料），由這個 route-scoped boundary
// 接住顯示「系統忙碌」，不再誤渲染成 notFound()／空清單。
export default function AccountError({ reset }: { reset: () => void }) {
  return (
    <SystemBusyErrorBoundary
      reset={reset}
      message="暫時無法讀取訂單資料，請稍候片刻再試一次"
    />
  );
}
