"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

type FooterLink = { label: string; href: string }

// footer 欄位：手機為可展開手風琴（點 +/− 開合），桌機（md+）恆展開、無 toggle。
// isDesktop 由父層 FooterColumns 一次算出後傳入（不再各欄自建 matchMedia 監聽）。
export function FooterColumn({
  heading,
  links,
  isDesktop,
}: {
  heading: string
  links: FooterLink[]
  isDesktop: boolean
}) {
  // 預設展開：SSR／停用 JS／hydration 前連結恆可見（漸進增強，不讓頁尾連結在
  // 手機無法點）；掛載後手機才收合為手風琴，桌機由 md:flex 恆顯示。
  const [open, setOpen] = useState(true)
  useEffect(() => {
    // 延到 rAF，不在 effect body 同步 setState（cascading render）。一次性判斷、
    // 非訂閱（跨斷點的響應交給父層 isDesktop）。
    const raf = requestAnimationFrame(() => {
      if (!window.matchMedia("(min-width: 768px)").matches) setOpen(false)
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  // 桌機連結恆可見，disclosure 語意應為展開；手機才反映實際開合。
  const expanded = isDesktop || open

  return (
    <div className="border-t border-paper/15 md:border-0">
      {/* 用 h2 保留頁尾區塊標題地標（輔助科技可靠標題導覽跳到各欄） */}
      <h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={expanded}
          tabIndex={isDesktop ? -1 : undefined}
          className="flex w-full items-center justify-between py-4 md:pointer-events-none md:py-0"
        >
          <span className="text-[11px] tracking-[0.2em] text-secondary-400 uppercase">
            {heading}
          </span>
          <span aria-hidden className="text-paper/60 md:hidden">
            {open ? (
              <Minus className="size-4" strokeWidth={1.5} />
            ) : (
              <Plus className="size-4" strokeWidth={1.5} />
            )}
          </span>
        </button>
      </h2>

      <div
        className={cn(
          "flex-col gap-2.5 pb-5 md:mt-3.5 md:flex md:pb-0",
          open ? "flex" : "hidden",
        )}
      >
        {links.map((link) => (
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
  )
}
