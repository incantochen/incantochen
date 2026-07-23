import { computeStartPrice } from "@/lib/product/start-price";
import {
  GEM_COLOR_OPTION_CODE,
  METAL_COLOR_OPTION_CODE,
} from "@/lib/product/option-type-codes";
import type { ProductCardData } from "@/components/product-card";

// 商品卡查詢的單一出處：首頁精選（featured-products）與品類頁（collections）
// 共用同一段 !inner embed select 與 row→ProductCardData 對應，避免兩處複本
// 失同步（此路徑含「起」價與 meta 顯示；同 computeStartPrice 的單一出處原則）。
//
// as const 保留字面型別，讓 Supabase 的 .select() 仍能推導精確 row 型別。
export const PRODUCT_CARD_SELECT = `
  slug, name, base_price,
  product_option (
    option_type!inner ( code ),
    product_option_value (
      is_default, price_delta,
      option_value!inner ( label, swatch_hex )
    )
  )
` as const;

// PRODUCT_CARD_SELECT 對應的 row 形狀（!inner embed 為非 null；numeric 欄位
// 生成型別標 number，PostgREST 執行期可能回字串——由 computeStartPrice 以
// Number() 收斂）。
type ProductCardRow = {
  slug: string;
  name: string;
  base_price: number;
  product_option: {
    option_type: { code: string };
    product_option_value: {
      is_default: boolean;
      price_delta: number;
      option_value: { label: string; swatch_hex: string | null };
    }[];
  }[];
};

export function mapProductRowToCardData(product: ProductCardRow): ProductCardData {
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
}
