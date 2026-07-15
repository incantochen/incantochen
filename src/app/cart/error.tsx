"use client";

// T95（F-008）：getCart 對 DB 暫時性故障改 throw，由這個 error boundary
// 接住顯示系統忙碌——不可讓故障渲染成「購物袋是空的」誤報。
export default function CartError({ reset }: { reset: () => void }) {
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
