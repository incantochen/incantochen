"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Search, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { MobileNav } from "@/components/mobile-nav"
import { CATEGORY_NAV } from "@/components/site-nav-links"

// 透明態（首頁 hero 上）沿用原本編輯感導覽；捲動轉實色後改列五品類。
const OVERLAY_NAV = [
  { label: "COLLECTIONS", href: "/collections/ring" },
  { label: "CUSTOM", href: "#" },
  { label: "ABOUT", href: "#" },
]

// 導覽列外殼（client）：首頁 hero 上透明浮層（paper 白字），捲離頂端後轉實色；
// 其他頁一律實色 sticky。購物車 icon（含徽章，讀 DB）由 server 端 SiteHeader
// 預渲染後以 cartSlot 傳入，避免把 async server 邏輯搬進 client。
export function HeaderChrome({ cartSlot }: { cartSlot: ReactNode }) {
  const pathname = usePathname()
  const isHome = pathname === "/"
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const transparent = isHome && !scrolled

  return (
    <header
      className={cn(
        "sticky top-0 z-40 h-[var(--header-height)] transition-colors duration-300",
        transparent ? "bg-transparent" : "border-b border-border bg-paper",
      )}
    >
      <div className="mx-auto grid h-full max-w-[1240px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-6">
        <Link
          href="/"
          aria-label="incantochen 辰醉金閣 首頁"
          className={cn(
            "flex items-baseline gap-2 font-heading transition-colors",
            transparent ? "text-paper" : "text-ink",
          )}
        >
          <span className="text-lg tracking-[0.28em] uppercase">INCANTOCHEN</span>
          <span aria-hidden className="text-secondary-400">
            ·
          </span>
          <span className="text-base tracking-[0.12em]">辰醉金閣</span>
        </Link>

        <nav
          className={cn(
            "hidden items-center justify-center md:flex",
            transparent ? "gap-9" : "gap-8",
          )}
        >
          {transparent
            ? OVERLAY_NAV.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="text-xs tracking-[0.22em] text-paper/85 uppercase transition-colors hover:text-secondary-400"
                >
                  {link.label}
                </Link>
              ))
            : CATEGORY_NAV.map((link) => (
                <Link
                  key={link.en}
                  href={link.href}
                  className="flex flex-col items-center leading-tight text-ink/85 transition-colors hover:text-secondary-400"
                >
                  <span className="text-[13px] tracking-[0.10em]">{link.zh}</span>
                  <span className="mt-0.5 text-[9px] tracking-[0.22em] uppercase opacity-60">
                    {link.en}
                  </span>
                </Link>
              ))}
        </nav>

        <div
          className={cn(
            "flex items-center justify-end gap-5 transition-colors",
            transparent ? "text-paper" : "text-ink",
          )}
        >
          <Link
            href="/collections/ring"
            aria-label="搜尋"
            className="opacity-80 hover:text-secondary-400 hover:opacity-100"
          >
            <Search className="size-[18px]" strokeWidth={1.4} />
          </Link>
          <Link
            href="/account"
            aria-label="會員"
            className="opacity-80 hover:text-secondary-400 hover:opacity-100"
          >
            <User className="size-[18px]" strokeWidth={1.4} />
          </Link>
          {cartSlot}
          <MobileNav />
        </div>
      </div>
    </header>
  )
}
