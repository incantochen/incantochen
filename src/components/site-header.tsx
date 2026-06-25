import Link from "next/link"
import { Search, ShoppingBag, User } from "lucide-react"

const navLinks = [
  { label: "COLLECTIONS", href: "/collections/ring" },
  { label: "CUSTOM", href: "#" },
  { label: "ABOUT", href: "#" },
]

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-paper">
      <div className="mx-auto grid max-w-[1240px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 py-4">
        <Link
          href="/"
          className="font-heading text-lg tracking-[0.28em] text-ink uppercase"
        >
          INCANTOCHEN
        </Link>

        <nav className="hidden justify-center gap-9 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-xs tracking-[0.22em] text-ink/80 uppercase hover:text-secondary-400"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-5 text-ink">
          <Link href="/collections/ring" aria-label="搜尋" className="opacity-80 hover:text-secondary-400 hover:opacity-100">
            <Search className="size-[18px]" strokeWidth={1.4} />
          </Link>
          <Link href="#" aria-label="會員" className="opacity-80 hover:text-secondary-400 hover:opacity-100">
            <User className="size-[18px]" strokeWidth={1.4} />
          </Link>
          <Link href="/cart" aria-label="購物袋" className="opacity-80 hover:text-secondary-400 hover:opacity-100">
            <ShoppingBag className="size-[18px]" strokeWidth={1.4} />
          </Link>
        </div>
      </div>
    </header>
  )
}
