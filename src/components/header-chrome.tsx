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

// 讀 --header-height（globals.css :root）作為 header 下緣高度，供深/淺區偵測的
// rootMargin 使用——由 header 高度推導、不寫死，header 高度變更自動跟隨。
function getHeaderHeight() {
  const v = getComputedStyle(document.documentElement).getPropertyValue(
    "--header-height",
  )
  return parseFloat(v) || 65
}

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

  // 首頁：依捲動方向切浮層/實色（頁首一律浮層）。純 scrollY 計算、無 hit-test。
  useEffect(() => {
    if (!isHome) return
    lastY.current = window.scrollY
    let raf = 0
    let firstRun = true
    const update = () => {
      raf = 0
      const y = window.scrollY
      const dy = y - lastY.current
      lastY.current = y
      // 頁首一律浮層；否則依方向：往上滾浮層、往下滾實色（<4px 抖動不切換）。
      // 初次量測 dy≈0 無方向可判——深連結落在已捲動的頁面時直接判實色，
      // 不讓 header 卡在初始的浮層態直到使用者首次捲動。
      if (y <= 8) setFloatState(true)
      else if (firstRun) setFloatState(false)
      else if (Math.abs(dy) > 4) setFloatState(dy < 0)
      firstRun = false
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

  // 首頁：浮層字色（深/淺區）用 IntersectionObserver 監看 data-nav-dark 區段
  // 是否覆蓋 header 下緣那條線——只在區段進出時觸發，取代每幀 elementFromPoint
  // 的同步 hit-test（省 layout flush，低階裝置捲動較順）。
  useEffect(() => {
    if (!isHome) return
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("[data-nav-dark]"),
    )
    if (!sections.length) return
    const intersecting = new Set<Element>()
    let observer: IntersectionObserver | null = null
    const build = () => {
      observer?.disconnect()
      intersecting.clear()
      const headerH = getHeaderHeight()
      // 觀察區縮成 header 下緣的 1px 橫線：top 減 header 高、bottom 只留 1px。
      const bottom = -(window.innerHeight - headerH - 1)
      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) intersecting.add(e.target)
            else intersecting.delete(e.target)
          }
          setOnDarkState(intersecting.size > 0)
        },
        { rootMargin: `${-headerH}px 0px ${bottom}px 0px`, threshold: 0 },
      )
      sections.forEach((s) => observer!.observe(s))
    }
    build()
    // 視窗高度變動會改變那條線位置，rAF 節流後重建 observer。
    let resizeRaf = 0
    const onResize = () => {
      if (!resizeRaf)
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0
          build()
        })
    }
    window.addEventListener("resize", onResize)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", onResize)
      if (resizeRaf) cancelAnimationFrame(resizeRaf)
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
            : CATEGORY_NAV.map((link) => {
                const active = pathname === link.href
                return (
                  <Link
                    key={link.en}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex flex-col items-center leading-tight transition-colors hover:text-secondary-400",
                      active ? "text-primary" : "text-ink/85",
                    )}
                  >
                    <span className="text-[13px] tracking-[0.10em]">{link.zh}</span>
                    <span className="mt-0.5 text-[9px] tracking-[0.22em] uppercase opacity-60">
                      {link.en}
                    </span>
                  </Link>
                )
              })}
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
