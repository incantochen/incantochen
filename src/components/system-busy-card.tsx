"use client";

// 「系統忙碌中」提示卡的單一表現層出處：error boundary（帶重試按鈕）與
// checkout/system-busy-notice（純提示、無按鈕）共用，消除三份近乎相同的
// JSX。variant 對齊 CLAUDE.md §3「admin 用 gray 素色、前台用品牌 token」；
// message 由呼叫端傳（購物袋 vs 訂單資料語意不同）；onRetry 有給才渲染按鈕。
export function SystemBusyCard({
  variant = "brand",
  message,
  onRetry,
}: {
  variant?: "brand" | "admin";
  message: string;
  onRetry?: () => void;
}) {
  if (variant === "admin") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">
            系統忙碌中
          </h1>
          <p className={`text-sm text-gray-500 ${onRetry ? "mb-8" : ""}`}>
            {message}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-block rounded-md border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              重新載入
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="font-head text-2xl text-ink mb-2">系統忙碌中</h1>
        <p className={`text-sm text-ash ${onRetry ? "mb-8" : ""}`}>{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-block rounded-[2px] border border-primary px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            重新載入
          </button>
        )}
      </div>
    </main>
  );
}
