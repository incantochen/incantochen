"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "@/app/account/actions"

const linkClass = (active: boolean) =>
  `block px-3 py-2 rounded text-sm font-medium ${
    active
      ? "bg-gray-900 text-white"
      : "text-gray-700 hover:bg-gray-100"
  }`

export function AdminNav() {
  const pathname = usePathname()
  const isOrdersActive = pathname.startsWith("/admin/orders")
  const isProductsActive = pathname.startsWith("/admin/products")

  return (
    <nav className="flex flex-col gap-1">
      <Link href="/admin/orders" className={linkClass(isOrdersActive)}>
        訂單管理
      </Link>
      <Link href="/admin/products" className={linkClass(isProductsActive)}>
        商品管理
      </Link>
      <form action={signOut} className="mt-4 px-3">
        <button
          type="submit"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          登出
        </button>
      </form>
    </nav>
  )
}
