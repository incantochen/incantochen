import Link from "next/link"
import { Suspense } from "react"
import { ShoppingBag } from "lucide-react"
import { getCartCount } from "@/lib/cart/get-cart-count"
import { HeaderChrome } from "@/components/header-chrome"

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

// 購物車 icon 讀 DB（getCartCount），屬 server 端邏輯——在此預渲染後以
// cartSlot 傳入 client 的 HeaderChrome（透明/實色切換需要 usePathname＋捲動）。
export function SiteHeader() {
  return (
    <HeaderChrome
      cartSlot={
        <Suspense
          fallback={
            <Link href="/cart" aria-label="購物袋" className="opacity-80 hover:text-secondary-400 hover:opacity-100">
              <ShoppingBag className="size-[18px]" strokeWidth={1.4} />
            </Link>
          }
        >
          <CartIconWithBadge />
        </Suspense>
      }
    />
  )
}
