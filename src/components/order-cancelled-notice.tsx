import Link from "next/link";

// T119：已取消訂單（resolvePendingOrderForCart 以同購物車重新結帳頂替舊待付款單、
// 或 T66 逾期取消）的 /checkout/pay、/checkout/success 連結原一律靜默 redirect("/")，
// 客人只覺得「訂單憑空消失」，且可能停在已開啟的舊 ECPay 頁面繼續付款（錢付進
// 已取消訂單、靠 Sentry＋每日對帳事後人工退款）。改渲染此說明頁明確打斷，供
// pay／success 兩頁共用。純說明、不揭露 PII、不動狀態機。
export function OrderCancelledNotice() {
  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <p className="eyebrow mb-4">ORDER CANCELLED</p>
        <h1 className="font-head text-2xl text-ink mb-3">此訂單已取消</h1>
        <p className="text-sm text-ash mb-8 leading-relaxed">
          這筆訂單已被取消，可能已由新的訂單取代。請改用最新的訂單連結；如果您正停在付款頁面，請勿繼續付款。
        </p>
        <Link
          href="/"
          className="inline-block rounded-[2px] bg-primary px-8 py-3 text-[11.5px] font-medium uppercase tracking-[0.2em] text-primary-foreground transition-colors hover:bg-primary/90"
        >
          返回首頁
        </Link>
      </div>
    </main>
  );
}
