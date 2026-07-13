import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { CATEGORY_LABELS, ALL_CATEGORIES } from "@/lib/product/category-labels"
import type { CategoryCode } from "@/lib/product/category-labels"
import { ProductCard, type ProductCardData } from "@/components/product-card"
import { CollectionSortSelect } from "@/components/collection-sort-select"

type SortKey = "featured" | "price_asc" | "price_desc" | "newest"
const VALID_SORT_KEYS: SortKey[] = ["featured", "price_asc", "price_desc", "newest"]

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>
  searchParams: Promise<{ sort?: string }>
}) {
  const { category } = await params
  if (!ALL_CATEGORIES.includes(category as CategoryCode)) {
    notFound()
  }
  const categoryCode = category as CategoryCode

  const { sort } = await searchParams
  const sortKey: SortKey = VALID_SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : "featured"

  const supabase = await createClient()

  let productQuery = supabase
    .from("product")
    .select(
      `
      slug, name, base_price,
      product_option (
        option_type ( code ),
        product_option_value (
          is_default,
          option_value ( label, swatch_hex )
        )
      )
    `,
    )
    .eq("status", "active")
    .eq("category", categoryCode)

  if (sortKey === "price_asc") {
    productQuery = productQuery.order("base_price", { ascending: true })
  } else if (sortKey === "price_desc") {
    productQuery = productQuery.order("base_price", { ascending: false })
  } else {
    // "newest" 與 "featured"（MVP 無推薦排序，先以最新上架代替）皆用建立時間新到舊。
    productQuery = productQuery.order("created_at", { ascending: false })
  }

  const [{ data: products, error }, { data: activeProducts, error: countsError }] = await Promise.all([
    productQuery,
    supabase.from("product").select("category").eq("status", "active"),
  ])

  if (error) {
    throw new Error(`載入商品列表失敗：${error.message}`)
  }
  if (countsError) {
    throw new Error(`載入品類狀態失敗：${countsError.message}`)
  }

  // 品類 tab 是否可點：後台上架該品類任一商品後自動點亮，不需另外維護開關。
  const categoriesWithProducts = new Set((activeProducts ?? []).map((p) => p.category))

  const cards: ProductCardData[] = products.map((product) => {
    const gemOption = product.product_option.find((o) => o.option_type.code === "gem_color")
    const metalOption = product.product_option.find((o) => o.option_type.code === "metal_color")
    const gemDefault = gemOption?.product_option_value.find((v) => v.is_default)?.option_value
    const metalDefault = metalOption?.product_option_value.find((v) => v.is_default)?.option_value
    const metaParts = [metalDefault?.label, gemDefault?.label].filter((v): v is string => Boolean(v))

    return {
      slug: product.slug,
      name: product.name,
      basePrice: Number(product.base_price),
      meta: metaParts.length > 0 ? metaParts.join(" · ") : null,
      gemColor: gemDefault?.swatch_hex ?? null,
    }
  })

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      <nav className="text-xs tracking-[0.1em] text-ash uppercase">
        <Link href="/" className="hover:text-primary">
          首頁
        </Link>
        {" / "}
        <span>商品</span>
        {" / "}
        <span>{CATEGORY_LABELS[categoryCode]}</span>
      </nav>

      <div className="mt-6">
        <div className="eyebrow">COLLECTIONS</div>
        <h1 className="mt-2 font-heading text-[34px] text-ink">{CATEGORY_LABELS[categoryCode]}</h1>
        <p className="mt-2 max-w-[46ch] text-sm text-ash">
          以彩色寶石為主角的半客製作品。選妳的顏色、金屬與尺寸，下單後專屬訂製。
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3.5">
        <div className="flex flex-wrap gap-6">
          {ALL_CATEGORIES.map((c) => {
            const isActive = c === categoryCode
            const hasProducts = categoriesWithProducts.has(c)

            if (!hasProducts && !isActive) {
              return (
                <span key={c} className="text-xs tracking-[0.22em] text-stone uppercase">
                  {CATEGORY_LABELS[c]}（即將推出）
                </span>
              )
            }

            return (
              <Link
                key={c}
                href={`/collections/${c}`}
                className={
                  isActive
                    ? "border-b-2 border-secondary-400 pb-1 text-xs tracking-[0.22em] text-primary uppercase"
                    : "pb-1 text-xs tracking-[0.22em] text-ink/80 uppercase hover:text-secondary-400"
                }
              >
                {CATEGORY_LABELS[c]}
              </Link>
            )
          })}
        </div>

        <CollectionSortSelect value={sortKey} />
      </div>

      {cards.length === 0 ? (
        <div className="mt-10 rounded-lg border border-border bg-cloud px-6 py-10 text-center text-ash">
          此品類即將推出，敬請期待。
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}
