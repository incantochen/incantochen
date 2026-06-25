import Link from "next/link"
import { notFound } from "next/navigation"
import { Gem } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database.types"
import { ProductConfigurator, type ConfiguratorOption } from "@/components/product-configurator"

type CategoryCode = Database["public"]["Enums"]["product_category"]

const CATEGORY_LABELS: Record<CategoryCode, string> = {
  ring: "戒指",
  earring: "耳環",
  bracelet: "手鍊",
  necklace: "項鍊",
}

const GALLERY_CAPTIONS = ["正面", "側面", "配戴情境", "生活情境"]

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: product } = await supabase
    .from("product")
    .select(
      `
      *,
      product_option (
        id, sort_order, required,
        option_type:option_type_id ( id, code, name, applies_to, input_type ),
        product_option_value (
          id, price_delta, is_default,
          option_value:option_value_id ( id, code, label, sort_order )
        )
      )
    `,
    )
    .eq("slug", slug)
    .eq("status", "active")
    .single()

  if (!product) {
    notFound()
  }

  const options = [...product.product_option].sort((a, b) => a.sort_order - b.sort_order)

  const categoryLabel = CATEGORY_LABELS[product.category]

  const configuratorOptions: ConfiguratorOption[] = options.map((option) => ({
    id: option.id,
    name: option.option_type.name,
    values: [...option.product_option_value]
      .sort((a, b) => a.option_value.sort_order - b.option_value.sort_order)
      .map((value) => ({
        id: value.id,
        label: value.option_value.label,
        isDefault: value.is_default,
        priceDelta: value.price_delta,
      })),
  }))

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      <nav className="text-xs tracking-[0.1em] text-ash uppercase">
        <Link href="/" className="hover:text-primary">
          首頁
        </Link>
        {" / "}
        <Link href={`/collections/${product.category}`} className="hover:text-primary">
          {categoryLabel}
        </Link>
        {" / "}
        <span>{product.name}</span>
      </nav>

      <div className="mt-8 grid grid-cols-1 items-start gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Gallery */}
        <div className="lg:sticky lg:top-24">
          <div className="relative flex aspect-square items-center justify-center rounded-lg border border-border bg-cloud">
            <Gem className="size-12 text-ash/60" strokeWidth={1.2} />
            <span className="absolute bottom-2 left-0 right-0 text-center text-[10.5px] tracking-[0.14em] text-ash uppercase">
              選配後合成主圖（依選項即時更新）
            </span>
          </div>
          <div className="mt-2.5 grid grid-cols-4 gap-2.5">
            {GALLERY_CAPTIONS.map((caption) => (
              <div
                key={caption}
                className="relative flex aspect-square items-center justify-center rounded-lg border border-border bg-cloud"
              >
                <span className="absolute bottom-1 left-0 right-0 text-center text-[10px] tracking-[0.1em] text-ash uppercase">
                  {caption}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Info / configurator skeleton */}
        <div>
          <div className="text-[11px] tracking-[0.34em] text-secondary-400 uppercase">
            {product.category} · {categoryLabel}
          </div>
          <h1 className="mt-2 font-heading text-[34px] text-ink">{product.name}</h1>

          <div className="mt-4">
            <ProductConfigurator basePrice={product.base_price} options={configuratorOptions} />
          </div>
        </div>
      </div>
    </div>
  )
}
