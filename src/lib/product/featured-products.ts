import { createClient } from "@/lib/supabase/server";
import {
  PRODUCT_CARD_SELECT,
  mapProductRowToCardData,
} from "@/lib/product/product-card-query";
import type { ProductCardData } from "@/components/product-card";

// 首頁「精選作品」查詢：跨品類撈上架商品、最新在前。MVP 無「推薦」旗標，
// 先以最新上架代表精選（與 collections 頁 "featured" 排序同語意）。select 與
// 卡片對應邏輯共用 product-card-query（與品類頁單一出處，避免失同步）。
export async function getFeaturedProducts(limit: number): Promise<ProductCardData[]> {
  const supabase = await createClient();

  const { data: products, error } = await supabase
    .from("product")
    .select(PRODUCT_CARD_SELECT)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`載入精選商品失敗：${error.message}`);
  }

  return (products ?? []).map(mapProductRowToCardData);
}
