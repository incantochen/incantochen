// T95（F-008）：success／pay 頁共用的 DB 暫時性故障提示。查詢 {error} 時
// 必須停在原地讓客人重新整理，絕不可 redirect 走人——已付款客人被踢回
// 首頁／空購物車，只會以為訂單消失了。
export function SystemBusyNotice() {
  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="font-head text-2xl text-ink mb-2">系統忙碌中</h1>
        <p className="text-sm text-ash">
          暫時無法讀取訂單資料，請稍候片刻後重新整理此頁面
        </p>
      </div>
    </main>
  );
}
