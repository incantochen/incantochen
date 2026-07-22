"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { User } from "lucide-react"
import { cn } from "@/lib/utils"
import { MobileNav } from "@/components/mobile-nav"
import { CATEGORY_NAV } from "@/components/site-nav-links"

// 浮層態（往上滾／頁首）沿用原本編輯感導覽；實色態（往下滾）改列五品類。
const OVERLAY_NAV = [
  { label: "COLLECTIONS", href: "/#products" },
  { label: "CUSTOM", href: "/custom" },
  { label: "ABOUT", href: "/#story" },
]

// header 下緣稍下方的探測點 y：用來判斷當下捲到深色區還是淺色區（決定浮層字色）。
const PROBE_Y = 72

// 導覽列外殼（client）。行為僅套在首頁：
//   往上滾 → 浮層（COLLECTIONS/CUSTOM/ABOUT）；文字隨背景深淺換色
//     深色區（data-nav-dark：hero/choose/story）→ 透明＋白字
//     淺色區 → 半透明毛玻璃＋深色字
//   往下滾 → 實色＋五品類（中/英兩行）
// 其他頁一律實色 sticky。購物車 icon（讀 DB）由 server 端 SiteHeader 預渲染傳入。
export function HeaderChrome({ cartSlot }: { cartSlot: ReactNode }) {
  const pathname = usePathname()
  const isHome = pathname === "/"
  // 浮層/深區狀態只在首頁有意義；用衍生值 float 讓非首頁一律實色，
  // 避免在 effect 內同步 setState（cascading render）。
  const [floatState, setFloatState] = useState(true)
  const [onDarkState, setOnDarkState] = useState(true)
  const lastY = useRef(0)

  useEffect(() => {
    if (!isHome) return
    lastY.current = window.scrollY
    let raf = 0
    const update = () => {
      raf = 0
      const y = window.scrollY
      const dy = y - lastY.current
      lastY.current = y
      // 頁首一律浮層；否則依方向：往上滾浮層、往下滾實色（<4px 抖動不切換）。
      if (y <= 8) setFloatState(true)
      else if (Math.abs(dy) > 4) setFloatState(dy < 0)
      // 浮層字色：探測 header 下方元素是否落在深色區段內。
      const el = document.elementFromPoint(window.innerWidth / 2, PROBE_Y)
      setOnDarkState(Boolean(el?.closest("[data-nav-dark]")))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    raf = requestAnimationFrame(update) // 初始量測（延到 rAF，不在 effect body 同步 setState）
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [isHome])

  const float = isHome && floatState
  const floatDark = float && onDarkState // 透明＋白字
  const lightText = floatDark // 前景是否用白色

  return (
    <header
      className={cn(
        "sticky top-0 z-40 h-[var(--header-height)] transition-colors duration-300",
        !float && "border-b border-border bg-paper",
        floatDark && "bg-transparent",
        float && !onDarkState && "border-b border-border/40 bg-paper/70 backdrop-blur-md",
      )}
    >
      <div className="mx-auto grid h-full max-w-[1240px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-6">
        <Link
          href="/"
          aria-label="incantochen 辰醉金閣 首頁"
          className={cn(
            "flex items-baseline gap-2 font-heading transition-colors",
            lightText ? "text-paper" : "text-ink",
          )}
        >
          {/* 桌機（sm+）一律 INCANTOCHEN · 辰醉金閣；手機浮層態顯示 INCANTOCHEN、
              手機實色態改中文 wordmark 辰醉金閣（見下方 sm:hidden 那顆）。 */}
          <span
            className={cn(
              "text-lg tracking-[0.28em] uppercase",
              float ? "inline" : "hidden sm:inline",
            )}
          >
            INCANTOCHEN
          </span>
          <span aria-hidden className="hidden text-secondary-400 sm:inline">
            ·
          </span>
          <span className="hidden text-base tracking-[0.12em] sm:inline">辰醉金閣</span>
          {!float && (
            <span className="text-xl tracking-[0.2em] sm:hidden">辰醉金閣</span>
          )}
        </Link>

        <nav
          className={cn(
            "hidden items-center justify-center md:flex",
            float ? "gap-9" : "gap-8",
          )}
        >
          {float
            ? OVERLAY_NAV.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={cn(
                    "text-xs tracking-[0.22em] uppercase transition-colors hover:text-secondary-400",
                    lightText ? "text-paper/85" : "text-ink/80",
                  )}
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
            // col-start-3 必要：手機時中間導覽 display:none 被 grid 跳過，
            // icons 會掉進中欄、右邊 1fr 空欄把它往左推；釘死第三欄才靠右。
            "col-start-3 flex items-center justify-end gap-5 transition-colors",
            lightText ? "text-paper" : "text-ink",
          )}
        >
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
