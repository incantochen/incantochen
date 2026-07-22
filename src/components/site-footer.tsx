import Link from "next/link"

// 版式與配色對齊 demo indexV2 footer：emerald-900 深底、大 wordmark＋三欄、
// 金色欄標、底部版權列。連結接真實路由；未建頁走占位（見 coming-soon）。
const columns = [
  {
    heading: "選購",
    links: [
      { label: "戒指", href: "/collections/ring" },
      { label: "耳環", href: "/collections/earring" },
      { label: "手鍊", href: "/collections/bracelet" },
      { label: "項鍊", href: "/collections/necklace" },
      { label: "所有產品", href: "/collections/ring" },
    ],
  },
  {
    heading: "服務",
    links: [
      { label: "尺寸與量法", href: "/ring-size" },
      { label: "預約訂製", href: "/custom" },
      { label: "退換與售後", href: "/after-sales" },
      { label: "訂單查詢", href: "/account/orders" },
    ],
  },
  {
    heading: "關於",
    links: [
      { label: "品牌故事", href: "/#story" },
      { label: "聯絡我們", href: "/contact" },
      { label: "隱私權政策", href: "/privacy" },
      { label: "服務條款", href: "/terms" },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="bg-primary-900 text-paper/75">
      <div className="mx-auto max-w-[1240px] px-6 pt-16 pb-8">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="font-heading text-2xl tracking-[0.24em] text-paper uppercase">
              INCANTOCHEN
            </div>
            <p className="mt-4 max-w-[34ch] text-[12.5px] leading-relaxed text-paper/60">
              以彩色寶石為主角的半客製珠寶。低調，有故事。
            </p>
            <p className="mt-3.5 max-w-[34ch] text-[12.5px] leading-relaxed text-paper/60">
              下單後為妳訂製，交期將於商品頁與結帳時告知。
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.heading}>
              <h4 className="text-[11px] tracking-[0.2em] text-secondary-400 uppercase">
                {col.heading}
              </h4>
              <div className="mt-3.5 flex flex-col gap-2.5">
                {col.links.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="text-[13.5px] text-paper/75 transition-colors hover:text-paper"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-paper/15 pt-5 text-xs text-paper/50">
          © 2026 INCANTOCHEN · 辰醉金閣
        </div>
      </div>
    </footer>
  )
}
