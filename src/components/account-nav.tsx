"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "@/app/account/actions"

const linkClass = (active: boolean) =>
  active
    ? "text-xs tracking-[0.22em] text-primary uppercase"
    : "text-xs tracking-[0.22em] text-ink/80 uppercase hover:text-secondary-400"

export function AccountNav() {
  const pathname = usePathname()
  const isOrdersActive = pathname === "/account" || pathname.startsWith("/account/orders")
  const isProfileActive = pathname.startsWith("/account/profile")

  return (
    <nav className="flex flex-col">
      <div className="flex flex-col gap-3.5">
        <Link href="/account/orders" className={linkClass(isOrdersActive)}>
          訂單
        </Link>
        <Link href="/account/profile" className={linkClass(isProfileActive)}>
          個人資料
        </Link>
      </div>
      <form action={signOut} className="mt-2.5">
        <button
          type="submit"
          className="text-xs tracking-[0.22em] text-ash uppercase hover:text-secondary-400"
        >
          登出
        </button>
      </form>
    </nav>
  )
}
