import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { CATEGORY_LABELS, ALL_CATEGORIES } from "@/lib/product/category-labels"
import type { CategoryCode } from "@/lib/product/category-labels"
import { ALL_SORT_KEYS, type SortKey } from "@/lib/product/collection-sort"
import {
  PRODUCT_CARD_SELECT,
  mapProductRowToCardData,
} from "@/lib/product/product-card-query"
import { buildBreadcrumbJsonLd } from "@/lib/seo/breadcrumb-json-ld"
import { getSiteUrl } from "@/lib/seo/site-url"
import { pageOpenGraph } from "@/lib/seo/site-meta"
import { ProductCard, type ProductCardData } from "@/components/product-card"
import { CollectionSortSelect } from "@/components/collection-sort-select"
import { Breadcrumb } from "@/components/breadcrumb"
import { JsonLd } from "@/components/json-ld"

// T59 SEO：品類頁 metadata。canonical 一律指向無 ?sort= 參數的乾淨網址——
// 排序變體內容相同，不讓搜尋引擎個別收錄。
export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category } = await params
  if (!ALL_CATEGORIES.includes(category as CategoryCode)) {
    return {}
  }
  const label = CATEGORY_LABELS[category as CategoryCode]
  const canonicalPath = `/collections/${category}`

  const title = `${label}系列`
  const description = `incantochen 半客製${label}系列——以彩色寶石為主角，選妳的寶石顏色、金屬與尺寸，即時計價，下單後專屬訂製。`
  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    // pageOpenGraph 帶回 siteName/locale/type（Next openGraph 淺層取代）。
    openGraph: pageOpenGraph({ title, description, url: canonicalPath }),
  }
}

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

  // select 與卡片對應共用 product-card-query（!inner／「起」價語意見該檔註解）。
  let productQuery = supabase
    .from("product")
    .select(PRODUCT_CARD_SELECT)
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

  // 品類切換已移至全站上方導覽（site-nav-links），本頁不再重複品類 tab，
  // 故也不需要逐品類的存在性探測，只撈本品類商品即可。
  const { data: products, error } = await productQuery

  if (error) {
    throw new Error(`載入商品列表失敗：${error.message}`)
  }

  const cards: ProductCardData[] = products.map(mapProductRowToCardData)

  const breadcrumbItems = [
    { label: "首頁", href: "/" },
    { label: "商品" },
    { label: CATEGORY_LABELS[categoryCode] },
  ]

  // T59 GEO：BreadcrumbList＋ItemList JSON-LD——ItemList 讓 AI 引擎能列舉
  // 本品類商品（名稱＋網址即可，價格細節在各 PDP 的 Product JSON-LD）。
  const siteUrl = getSiteUrl()
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `incantochen ${CATEGORY_LABELS[categoryCode]}系列`,
    itemListElement: cards.map((card, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: card.name,
      url: new URL(`/products/${card.slug}`, siteUrl).toString(),
    })),
  }

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      <JsonLd data={buildBreadcrumbJsonLd(breadcrumbItems)} />
      <JsonLd data={itemListJsonLd} />
      <Breadcrumb items={breadcrumbItems} />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="eyebrow">COLLECTIONS</div>
          <h1 className="mt-2 font-heading text-[34px] text-ink">{CATEGORY_LABELS[categoryCode]}</h1>
          <p className="mt-2 max-w-[46ch] text-sm text-ash">
            以彩色寶石為主角的半客製作品。選妳的顏色、金屬與尺寸，下單後專屬訂製。
          </p>
        </div>
        <CollectionSortSelect value={sortKey} />
      </div>

      {cards.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border bg-cloud px-6 py-10 text-center text-ash">
          此品類即將推出，敬請期待。
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {cards.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}
