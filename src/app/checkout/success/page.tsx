import Link from "next/link"

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>
}) {
  const { order } = await searchParams

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto">
          <svg
            className="h-8 w-8 text-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="font-head text-2xl text-ink mb-2">訂單已成功建立</h1>
        <p className="text-sm text-ash mb-6">感謝您的訂購，我們將盡快為您準備</p>

        {order && (
          <div className="mb-6 rounded-lg border border-border bg-cloud px-6 py-4">
            <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-1">訂單號碼</p>
            <p className="font-mono text-lg font-medium text-ink">{order}</p>
          </div>
        )}

        <Link
          href="/"
          className="inline-block rounded-[2px] border border-primary px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          返回首頁
        </Link>
      </div>
    </main>
  )
}
