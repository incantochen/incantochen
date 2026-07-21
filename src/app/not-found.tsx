import Link from "next/link";

// T62：全站 404。渲染於 root layout 的 <main> 內（SiteHeader/SiteFooter 由
// layout 提供，此處只放置中內容）。品牌 token 對齊 SystemBusyCard／brand-guide。
//
// ⚠️ 已知限制（T59 拍板接受，2026-07-21）：頁面內呼叫 notFound()（如 PDP 查
// 無商品）在本站預設動態渲染下，HTTP 狀態碼為 200、僅內容是本 404 頁＝
// soft-404（T62 PR #87 走查證實；未匹配路由則正確回 404）。狀態碼由 Next
// 的 notFound() streaming 機制決定、與本檔無關，Next 16 動態渲染下無乾淨的
// opt-in 修法。風險緩解：Google 對 soft-404 有內容判定兜底，且 sitemap 只列
// active 商品、下架商品不會被引導進來。若未來 Next 提供動態渲染回真 404 的
// 機制，再回頭收掉。
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
