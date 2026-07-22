"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Search, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { MobileNav } from "@/components/mobile-nav"

const navLinks = [
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

        <nav className="hidden justify-center gap-9 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className={cn(
                "text-xs tracking-[0.22em] uppercase transition-colors hover:text-secondary-400",
                transparent ? "text-paper/85" : "text-ink/80",
              )}
            >
              {link.label}
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
