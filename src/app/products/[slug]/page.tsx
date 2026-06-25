import Link from "next/link"
import { notFound } from "next/navigation"
import { Gem } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database.types"

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

  const defaultPriceDelta = options.reduce((sum, option) => {
    const defaultValue = option.product_option_value.find((value) => value.is_default)
    return sum + (defaultValue?.price_delta ?? 0)
  }, 0)
  const startingPrice = product.base_price + defaultPriceDelta

  const categoryLabel = CATEGORY_LABELS[product.category]

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

          <div className="mt-4 flex items-baseline gap-3">
            <div className="text-3xl font-medium text-primary">
              NT$ {startingPrice.toLocaleString()}
            </div>
            <span className="text-sm text-ash">底價 NT$ {product.base_price.toLocaleString()} 起</span>
          </div>

          <hr className="my-6 h-px border-0 bg-secondary-400/50" />

          {options.map((option, index) => {
            const values = [...option.product_option_value].sort(
              (a, b) => a.option_value.sort_order - b.option_value.sort_order,
            )
            return (
              <div key={option.id} className="py-4">
                <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
                  {String(index + 1).padStart(1, "0")}. {option.option_type.name}
                </label>
                <div className="mt-2 flex flex-wrap gap-2.5">
                  {values.map((value) => (
                    <span
                      key={value.id}
                      className={
                        value.is_default
                          ? "inline-flex items-center gap-2 rounded-lg border border-primary px-3.5 py-2 text-sm ring-2 ring-secondary-400"
                          : "inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm"
                      }
                    >
                      {value.option_value.label}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}

          <div className="mt-4 rounded-lg border border-border bg-cloud px-3.5 py-3 text-sm">
            ⓘ <strong>下單後為妳訂製</strong>，交期至少 <strong>XX</strong> 天，將於結帳再次告知。
          </div>

          <button
            type="button"
            className="mt-5 w-full rounded-[2px] bg-primary px-8 py-4 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase hover:bg-primary-700"
          >
            加入購物袋
          </button>
        </div>
      </div>
    </div>
  )
}
