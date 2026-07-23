"use client"

import { useState } from "react"
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
  // 手機預設收合（無展開→收合閃爍）；點 +/− 展開。桌機由 md:flex 恆顯示，
  // 與 open 無關。（放棄無 JS 可見的漸進增強——全站本就依賴 JS，取捨一致。）
  const [open, setOpen] = useState(false)
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
