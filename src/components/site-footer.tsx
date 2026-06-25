import Link from "next/link"

const columns = [
  {
    heading: "商品",
    links: [{ label: "戒指", href: "/collections/ring" }],
  },
  {
    heading: "支援",
    links: [
      { label: "戒圍量法", href: "/ring-size" },
      { label: "售後說明", href: "/after-sales" },
      { label: "預約訂製", href: "/custom" },
    ],
  },
  {
    heading: "法規",
    links: [
      { label: "隱私權政策", href: "/privacy" },
      { label: "服務條款", href: "/terms" },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="mt-16 bg-primary text-primary-foreground/80">
      <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-8 px-6 py-12 sm:grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="font-heading text-base tracking-[0.26em] text-primary-foreground uppercase">
            INCANTOCHEN
          </div>
          <p className="mt-3 max-w-[30ch] text-sm">
            天然彩色寶石與細膩工藝，融入日常、令人回味的珠寶。
          </p>
        </div>

        {columns.map((col) => (
          <div key={col.heading}>
            <h4 className="text-[10.5px] tracking-[0.2em] text-secondary-400 uppercase">
              {col.heading}
            </h4>
            <div className="mt-3 flex flex-col gap-1">
              {col.links.map((link) => (
                <Link key={link.label} href={link.href} className="py-1 text-sm hover:text-primary-foreground">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </footer>
  )
}
