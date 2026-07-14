import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { CATEGORY_LABELS, ALL_CATEGORIES } from "@/lib/product/category-labels"
import type { CategoryCode } from "@/lib/product/category-labels"
import { ALL_SORT_KEYS, type SortKey } from "@/lib/product/collection-sort"
import { GEM_COLOR_OPTION_CODE, METAL_COLOR_OPTION_CODE } from "@/lib/product/option-type-codes"
import { ProductCard, type ProductCardData } from "@/components/product-card"
import { CollectionSortSelect } from "@/components/collection-sort-select"
import { Breadcrumb } from "@/components/breadcrumb"

// 每個品類最多先撈這麼多筆；MVP 目錄規模遠小於此，真正的分頁/無限捲動留給
// 目錄成長到需要時再做（CLAUDE.md：不為假設中的規模預先設計），這裡只是
// 避免查詢完全不設上限。
const MAX_PRODUCTS_PER_CATEGORY = 60

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
  const sortKey: SortKey =
    typeof sort === "string" && ALL_SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : "featured"

  const supabase = await createClient()

  let productQuery = supabase
    .from("product")
    .select(
      `
      slug, name, base_price,
      product_option (
        option_type ( code ),
        product_option_value (
          is_default, price_delta,
          option_value ( label, swatch_hex )
        )
      )
    `,
    )
    .eq("status", "active")
    .eq("category", categoryCode)
    .limit(MAX_PRODUCTS_PER_CATEGORY)

  if (sortKey === "price_asc") {
    productQuery = productQuery.order("base_price", { ascending: true })
  } else if (sortKey === "price_desc") {
    productQuery = productQuery.order("base_price", { ascending: false })
  } else {
    // "newest" 與 "featured"（MVP 無推薦排序，先以最新上架代替）皆用建立時間新到舊。
    productQuery = productQuery.order("created_at", { ascending: false })
  }

  // 品類 tab 是否可點：後台上架該品類任一商品後自動點亮。用每品類各一次
  // .limit(1) 存在性探測（命中 (category,status) 複合索引即可回答，不需要
  // 撈出全站所有上架商品的 category 欄位再在 JS 端數）。
  const [{ data: products, error }, ...categoryChecks] = await Promise.all([
    productQuery,
    ...ALL_CATEGORIES.map((c) =>
      supabase.from("product").select("id").eq("status", "active").eq("category", c).limit(1),
    ),
  ])

  if (error) {
    throw new Error(`載入商品列表失敗：${error.message}`)
  }

  const categoriesWithProducts = new Set<CategoryCode>()
  ALL_CATEGORIES.forEach((c, i) => {
    const check = categoryChecks[i]
    if (check?.error) {
      throw new Error(`載入品類狀態失敗：${check.error.message}`)
    }
    if ((check?.data?.length ?? 0) > 0) {
      categoriesWithProducts.add(c)
    }
  })

  const cards: ProductCardData[] = products.map((product) => {
    const gemOption = product.product_option.find((o) => o.option_type.code === GEM_COLOR_OPTION_CODE)
    const metalOption = product.product_option.find(
      (o) => o.option_type.code === METAL_COLOR_OPTION_CODE,
    )
    const gemDefault = (
      gemOption?.product_option_value.find((v) => v.is_default) ?? gemOption?.product_option_value[0]
    )?.option_value
    const metalDefault = (
      metalOption?.product_option_value.find((v) => v.is_default) ??
      metalOption?.product_option_value[0]
    )?.option_value
    const metaParts = [metalDefault?.label, gemDefault?.label].filter((v): v is string => Boolean(v))

    // 「起」價＝底價＋每組選項「預設值」的加價總和，比照 product-configurator.tsx
    // 對 PDP 預設組合的算法——只用 base_price 的話，一旦某必選項的預設值本身
    // 帶加價，目錄頁顯示的價格會比 PDP／結帳實際金額低。
    const defaultPriceDeltaSum = product.product_option.reduce((sum, po) => {
      const def = po.product_option_value.find((v) => v.is_default) ?? po.product_option_value[0]
      return sum + (def?.price_delta ?? 0)
    }, 0)

    return {
      slug: product.slug,
      name: product.name,
      basePrice: Number(product.base_price) + Number(defaultPriceDeltaSum),
      meta: metaParts.length > 0 ? metaParts.join(" · ") : null,
      gemColor: gemDefault?.swatch_hex ?? null,
    }
  })

  function buildCategoryHref(c: CategoryCode) {
    return sortKey !== "featured" ? `/collections/${c}?sort=${sortKey}` : `/collections/${c}`
  }

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      <Breadcrumb
        items={[
          { label: "首頁", href: "/" },
          { label: "商品" },
          { label: CATEGORY_LABELS[categoryCode] },
        ]}
      />

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
            const label = hasProducts ? CATEGORY_LABELS[c] : `${CATEGORY_LABELS[c]}（即將推出）`

            if (!hasProducts && !isActive) {
              return (
                <span key={c} className="text-xs tracking-[0.22em] text-stone uppercase">
                  {label}
                </span>
              )
            }

            return (
              <Link
                key={c}
                href={buildCategoryHref(c)}
                aria-current={isActive ? "page" : undefined}
                className={
                  isActive
                    ? "border-b-2 border-secondary-400 pb-1 text-xs tracking-[0.22em] text-primary uppercase"
                    : "pb-1 text-xs tracking-[0.22em] text-ink/80 uppercase hover:text-secondary-400"
                }
              >
                {label}
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
