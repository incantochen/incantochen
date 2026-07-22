import { createClient } from "@/lib/supabase/server";
import { computeStartPrice } from "@/lib/product/start-price";
import {
  GEM_COLOR_OPTION_CODE,
  METAL_COLOR_OPTION_CODE,
} from "@/lib/product/option-type-codes";
import type { ProductCardData } from "@/components/product-card";

// 首頁「精選作品」查詢：跨品類撈上架商品、最新在前。MVP 無「推薦」旗標，
// 先以最新上架代表精選（與 collections 頁 "featured" 排序同語意）。查詢與
// 卡片對應邏輯刻意與 collections/[category]/page.tsx 對齊——!inner embed 濾掉
// is_active=false 選項、「起」價走 computeStartPrice 單一出處。此處自足不共用
// collections 的 inline 版，避免為首頁擴大改動品類頁的範圍（T44）。
export async function getFeaturedProducts(limit: number): Promise<ProductCardData[]> {
  const supabase = await createClient();

  const { data: products, error } = await supabase
    .from("product")
    .select(
      `
      slug, name, base_price,
      product_option (
        option_type!inner ( code ),
        product_option_value (
          is_default, price_delta,
          option_value!inner ( label, swatch_hex )
        )
      )
    `,
    )
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`載入精選商品失敗：${error.message}`);
  }

  return (products ?? []).map((product) => {
    const gemOption = product.product_option.find(
      (o) => o.option_type.code === GEM_COLOR_OPTION_CODE,
    );
    const metalOption = product.product_option.find(
      (o) => o.option_type.code === METAL_COLOR_OPTION_CODE,
    );
    const gemDefault = (
      gemOption?.product_option_value.find((v) => v.is_default) ??
      gemOption?.product_option_value[0]
    )?.option_value;
    const metalDefault = (
      metalOption?.product_option_value.find((v) => v.is_default) ??
      metalOption?.product_option_value[0]
    )?.option_value;
    const metaParts = [metalDefault?.label, gemDefault?.label].filter(
      (v): v is string => Boolean(v),
    );

    return {
      slug: product.slug,
      name: product.name,
      basePrice: computeStartPrice(product.base_price, product.product_option),
      meta: metaParts.length > 0 ? metaParts.join(" · ") : null,
      gemColor: gemDefault?.swatch_hex ?? null,
    };
  });
}
