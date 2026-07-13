"use client"

import { Dialog } from "radix-ui"
import Link from "next/link"
import { Menu, X } from "lucide-react"

const navLinks = [
  { label: "COLLECTIONS", href: "/collections/ring" },
  { label: "CUSTOM", href: "#" },
  { label: "ABOUT", href: "#" },
]

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

          <nav className="mt-10 flex flex-col gap-6">
            {navLinks.map((link) => (
              <Dialog.Close asChild key={link.label}>
                <Link
                  href={link.href}
                  className="text-sm tracking-[0.22em] text-ink uppercase hover:text-secondary-400"
                >
                  {link.label}
                </Link>
              </Dialog.Close>
            ))}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
