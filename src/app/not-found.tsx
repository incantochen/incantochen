import Link from "next/link";

// T62：全站 404。渲染於 root layout 的 <main> 內（SiteHeader/SiteFooter 由
// layout 提供，此處只放置中內容）。品牌 token 對齊 SystemBusyCard／brand-guide。
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-20 text-center">
      <p className="eyebrow mb-5">PAGE NOT FOUND</p>
      <h1 className="font-head text-3xl text-ink sm:text-4xl">找不到這個頁面</h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-ash">
        您要找的頁面可能已移除，或網址有誤。
      </p>
      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
        <Link
          href="/"
          className="inline-block rounded-[2px] bg-primary px-8 py-3 text-[11.5px] font-medium uppercase tracking-[0.2em] text-primary-foreground transition-colors hover:bg-primary/90"
        >
          返回首頁
        </Link>
        <Link
          href="/collections/ring"
          className="inline-block rounded-[2px] border border-primary px-8 py-3 text-[11.5px] font-medium uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          瀏覽作品
        </Link>
      </div>
    </div>
  );
}
