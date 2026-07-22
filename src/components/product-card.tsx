import Link from "next/link"
import { formatCurrency } from "@/lib/utils"
import { PlaceholderImage } from "@/components/placeholder-image"

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
      // 邊框沿用 demo 卡片的較淺色 #ece8e0（比 --border #d9d5cc 更含蓄）
      className="group overflow-hidden rounded-lg border border-[#ece8e0] bg-white transition hover:-translate-y-1 hover:shadow-[0_22px_44px_-28px_rgba(6,59,47,0.5)]"
    >
      <PlaceholderImage
        className="aspect-square border-b border-[#ece8e0]"
        iconSize="size-10"
        caption="配戴情境圖"
      />
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
