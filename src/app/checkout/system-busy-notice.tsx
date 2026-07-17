import { SystemBusyCard } from "@/components/system-busy-card";

// T95（F-008）：success／pay／failed 頁共用的 DB 暫時性故障提示。查詢
// {error} 時必須停在原地讓客人重新整理，絕不可 redirect 走人——已付款客人
// 被踢回首頁／空購物車，只會以為訂單消失了。無重試按鈕（付款流程頁重整
// 即可）。
export function SystemBusyNotice() {
  return (
    <SystemBusyCard
      variant="brand"
      message="暫時無法讀取訂單資料，請稍候片刻後重新整理此頁面"
    />
  );
}
