"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

type FooterLink = { label: string; href: string }

// footer 欄位：手機為可展開手風琴（點 +/− 開合），桌機（md+）恆展開、無 toggle。
export function FooterColumn({
  heading,
  links,
}: {
  heading: string
  links: FooterLink[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-t border-paper/15 md:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
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
