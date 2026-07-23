"use client"

import { Dialog } from "radix-ui"
import Link from "next/link"
import { Menu, X } from "lucide-react"
import { CATEGORY_NAV } from "@/components/site-nav-links"

export function MobileNav() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="開啟選單"
          className="opacity-80 hover:text-secondary-400 hover:opacity-100 md:hidden"
        >
          <Menu className="size-[20px]" strokeWidth={1.4} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex w-[78%] max-w-[320px] flex-col bg-paper px-6 py-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="font-heading text-base tracking-[0.26em] text-ink uppercase">
              INCANTOCHEN
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="關閉選單" className="text-ink opacity-80 hover:opacity-100">
                <X className="size-5" strokeWidth={1.4} />
              </button>
            </Dialog.Close>
          </div>

          <nav className="mt-10 flex flex-col gap-5">
            {CATEGORY_NAV.map((link) => (
              <Dialog.Close asChild key={link.en}>
                <Link
                  href={link.href}
                  className="flex flex-col leading-tight text-ink hover:text-secondary-400"
                >
                  <span className="text-base tracking-[0.10em]">{link.zh}</span>
                  <span className="mt-0.5 text-[10px] tracking-[0.22em] text-ash uppercase">
                    {link.en}
                  </span>
                </Link>
              </Dialog.Close>
            ))}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
