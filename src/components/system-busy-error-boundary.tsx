"use client";

// T95（F-008）review 修正：getCart() 對 DB 暫時性故障改 throw 後，凡是呼叫
// getCart() 的頁面都需要一個 route-scoped error boundary 接住，否則會掉到
// global-error.tsx 把整個 <html> 卸載——比修復前的行為更糟。/checkout 與
// /admin/orders/checkout 原本沒有這層（只有 /cart 有），此元件供三處共用，
// 避免各自複製一份幾乎相同的 JSX（variant 對齊 CLAUDE.md §3 admin／前台
// 視覺刻意分開的規則：admin 用 gray 素色，前台用品牌 token）。
export function SystemBusyErrorBoundary({
  reset,
  variant = "brand",
}: {
  reset: () => void;
  variant?: "brand" | "admin";
}) {
  if (variant === "admin") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">
            系統忙碌中
          </h1>
          <p className="mb-8 text-sm text-gray-500">
            暫時無法讀取購物袋內容，請稍候片刻再試一次
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-block rounded-md border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            重新載入
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="font-head text-2xl text-ink mb-2">系統忙碌中</h1>
        <p className="text-sm text-ash mb-8">
          暫時無法讀取購物袋內容，請稍候片刻再試一次
        </p>
        <button
          type="button"
          onClick={reset}
          className="inline-block rounded-[2px] border border-primary px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          重新載入
        </button>
      </div>
    </main>
  );
}
