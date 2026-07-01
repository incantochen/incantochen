import Link from "next/link"
import { Suspense } from "react"
import { Search, ShoppingBag, User } from "lucide-react"
import { getCartCount } from "@/lib/cart/get-cart-count"

const navLinks = [
  { label: "COLLECTIONS", href: "/collections/ring" },
  { label: "CUSTOM", href: "#" },
  { label: "ABOUT", href: "#" },
]

async function CartIconWithBadge() {
  const count = await getCartCount()
  return (
    <Link href="/cart" aria-label="購物袋" className="relative opacity-80 hover:text-secondary-400 hover:opacity-100">
      <ShoppingBag className="size-[18px]" strokeWidth={1.4} />
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold leading-none text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  )
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 h-[var(--header-height)] border-b border-border bg-paper">
      <div className="mx-auto grid h-full max-w-[1240px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-6">
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
          <Link href="/account" aria-label="會員" className="opacity-80 hover:text-secondary-400 hover:opacity-100">
            <User className="size-[18px]" strokeWidth={1.4} />
          </Link>
          <Suspense
            fallback={
              <Link href="/cart" aria-label="購物袋" className="opacity-80 hover:text-secondary-400 hover:opacity-100">
                <ShoppingBag className="size-[18px]" strokeWidth={1.4} />
              </Link>
            }
          >
            <CartIconWithBadge />
          </Suspense>
        </div>
      </div>
    </header>
  )
}
