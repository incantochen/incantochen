import Link from "next/link"
import { Gem } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

export type ProductCardData = {
  slug: string
  name: string
  basePrice: number
  meta: string | null
  gemColor: string | null
}

// 品牌卡規格見 brand-guide §7.4：寶石色點＋材質 meta＋serif 品名＋價格「起」。
export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group overflow-hidden rounded-lg border border-border bg-white transition hover:-translate-y-1 hover:shadow-[0_22px_44px_-28px_rgba(6,59,47,0.5)]"
    >
      <div className="relative flex aspect-square items-center justify-center border-b border-border bg-cloud">
        <Gem className="size-10 text-ash/60" strokeWidth={1.2} />
        <span className="absolute bottom-2 left-0 right-0 text-center text-[10.5px] tracking-[0.14em] text-ash uppercase">
          配戴情境圖
        </span>
      </div>
      <div className="px-4 py-4">
        {product.meta && (
          <div className="mb-1.5 flex items-center gap-2">
            {product.gemColor && (
              <span
                className="inline-block size-[9px] rounded-full"
                style={{ backgroundColor: product.gemColor }}
              />
            )}
            <span className="text-[10.5px] tracking-[0.16em] text-ash uppercase">
              {product.meta}
            </span>
          </div>
        )}
        <h3 className="font-heading text-lg text-ink">{product.name}</h3>
        <div className="mt-1.5 text-sm font-medium text-primary">
          {formatCurrency(product.basePrice)} 起
        </div>
      </div>
    </Link>
  )
}
