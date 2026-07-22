import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isProductUnavailable } from "@/lib/product/check-product-availability";
import { CATEGORY_LABELS } from "@/lib/product/category-labels";
import { computeStartPrice } from "@/lib/product/start-price";
import { buildBreadcrumbJsonLd } from "@/lib/seo/breadcrumb-json-ld";
import { getSiteUrl } from "@/lib/seo/site-url";
import { pageOpenGraph } from "@/lib/seo/site-meta";
import {
  ProductConfigurator,
  type ConfiguratorOption,
} from "@/components/product-configurator";
import { Breadcrumb } from "@/components/breadcrumb";
import { JsonLd } from "@/components/json-ld";
import { PlaceholderImage } from "@/components/placeholder-image";

const GALLERY_CAPTIONS = ["正面", "側面", "配戴情境", "生活情境"];

// React cache()：generateMetadata 與 page 在同一請求各要一次商品——去重成
// 單一 DB 查詢（T59）。
//
// option_type / option_value 的 !inner 必要：RLS（0014）會濾掉 is_active=false
// 的列，非 inner 的多對一 embed 會變成 null 欄位（取屬性即炸），!inner 才是
// 「隱藏項目整列從陣列消失」
const getActiveProduct = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data: product, error } = await supabase
    .from("product")
    .select(
      `
      *,
      product_option (
        id, sort_order, required,
        option_type:option_type_id!inner ( id, code, name, applies_to, input_type ),
        product_option_value (
          id, price_delta, is_default,
          option_value:option_value_id!inner ( id, code, label, sort_order, swatch_hex )
        )
      )
    `,
    )
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();

  // 查詢失敗 ≠ 查無商品（CLAUDE.md §6）：DB 暫時性故障要拋錯，
  // 不能讓存在的商品被誤判成 404
  if (error) {
    throw new Error(`查詢商品失敗：${error.message}`);
  }
  return product;
});

// T59 SEO：商品頁 metadata。description 由商品資料組合（不杜撰內容）；
// canonical 指向乾淨的 /products/[slug]。查無商品回空物件即可——page 端
// 的 notFound() 才是 404 的決定者，metadata 不重複判。
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getActiveProduct(slug);
  if (!product) {
    return {};
  }

  // ?? category：DB enum 若新增品類但程式尚未重新部署的窗口期，label 查無會是
  // undefined，直接串進 meta description 會外露「undefined」到搜尋摘要——退回
  // 原始 code 字串至少不出亂字。
  const categoryLabel = CATEGORY_LABELS[product.category] ?? product.category;
  const startPrice = computeStartPrice(
    product.base_price,
    product.product_option,
  );
  // toLocaleString 明示 zh-TW：不指定 locale 時千分位格式取決於 runtime ICU
  // 預設語系（非 Vercel／自架環境可能變成「27.500」歐式句點），會被搜尋摘要與
  // 分享卡誤讀成價格。
  const description = `半客製${categoryLabel}「${product.name}」，NT$ ${startPrice.toLocaleString("zh-TW")} 起。可選寶石顏色與金屬色，即時計價，下單後專屬訂製。`;
  const canonicalPath = `/products/${product.slug}`;

  return {
    title: product.name,
    description,
    alternates: { canonical: canonicalPath },
    // pageOpenGraph 帶回 siteName/locale/type（Next 對 openGraph 是淺層取代，
    // 只給 title/description/url 會蓋掉 layout 的基底欄位）。
    openGraph: pageOpenGraph({
      title: product.name,
      description,
      url: canonicalPath,
    }),
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getActiveProduct(slug);
  if (!product) {
    notFound();
  }

  // T117：anon 查詢看不到被隱藏的必選選項（整組從結果消失），故另用 service
  // role 比對真相，判斷此商品是否因必選選項被隱藏而暫停販售。只取回 boolean，
  // service role 明細不外流到 client。
  const unavailable = await isProductUnavailable(
    createServiceRoleClient(),
    product.id,
  );

  const options = [...product.product_option].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  // ?? category：DB enum 新增品類但程式未重部署的窗口期，label 查無退回 code
  //（同 generateMetadata），避免麵包屑／JSON-LD 出現 undefined。
  const categoryLabel = CATEGORY_LABELS[product.category] ?? product.category;

  const configuratorOptions: ConfiguratorOption[] = options.map((option) => ({
    id: option.id,
    name: option.option_type.name,
    inputType: option.option_type.input_type,
    values: [...option.product_option_value]
      .sort((a, b) => a.option_value.sort_order - b.option_value.sort_order)
      .map((value) => ({
        id: value.id,
        label: value.option_value.label,
        isDefault: value.is_default,
        // §6：PostgREST 對 numeric 欄位可能回字串——在資料進 client 元件的
        // 邊界統一 Number()（對齊 start-price.ts），否則配置器的 basePrice+Σ
        // 會變字串串接、可見價格與 add_to_cart value 全錯。
        priceDelta: Number(value.price_delta),
        swatchHex: value.option_value.swatch_hex,
      })),
  }));

  const breadcrumbItems = [
    { label: "首頁", href: "/" },
    { label: categoryLabel, href: `/collections/${product.category}` },
    { label: product.name },
  ];

  // T59 GEO：Product JSON-LD——AI 引擎與搜尋引擎讀結構化資料遠勝讀 DOM
  // （配置器價格在 client component，多數爬蟲不執行 JS）。
  // price＝「起」價（與目錄卡／metadata 同算法）；availability 接 T117 的
  // unavailable 訊號；image 待 T116 素材到位再補（不放佔位圖騙爬蟲）。
  const startPrice = computeStartPrice(
    product.base_price,
    product.product_option,
  );
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: `半客製${categoryLabel}，可選寶石顏色與金屬色，下單後專屬訂製。`,
    category: categoryLabel,
    brand: { "@type": "Brand", name: "incantochen" },
    // AggregateOffer + lowPrice（非單一 Offer.price）：半客製商品價格隨選配變動，
    // 用單一 price 標「起」價會與客人加選後的實際金額不符，Google 可能判定
    // 結構化價格與頁面價格矛盾而抑制 rich result。lowPrice＝起價（預設選配）；
    // 不放 highPrice（選配上界隨白名單變動、非固定，寧缺勿錯報）。
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "TWD",
      lowPrice: startPrice,
      // MadeToOrder（非 InStock）：全站商品皆為下單後接單訂製（見 description
      // 與 llms.txt），標 InStock 會讓 AI／搜尋引擎誤判為現貨可立即出貨、與
      // 頁面「下單後專屬訂製、交期數十天」自相矛盾。MadeToOrder 為 schema.org
      // ItemAvailability 合法值、Google 官方支援。暫停販售仍 OutOfStock。
      availability: unavailable
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/MadeToOrder",
      url: new URL(`/products/${product.slug}`, getSiteUrl()).toString(),
    },
  };

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      <JsonLd data={productJsonLd} />
      <JsonLd data={buildBreadcrumbJsonLd(breadcrumbItems)} />
      <Breadcrumb items={breadcrumbItems} />

      <div className="mt-8 grid grid-cols-1 items-start gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Gallery */}
        <div className="lg:sticky lg:top-24">
          <PlaceholderImage
            className="aspect-square rounded-lg border border-border"
            iconSize="size-12"
            caption="選配後合成主圖（依選項即時更新）"
          />
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
          <h1 className="mt-2 font-heading text-[34px] text-ink">
            {product.name}
          </h1>

          <div className="mt-4">
            <ProductConfigurator
              productId={product.id}
              productName={product.name}
              basePrice={Number(product.base_price)}
              options={configuratorOptions}
              unavailable={unavailable}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
