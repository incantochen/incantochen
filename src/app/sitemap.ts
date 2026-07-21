import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/seo/site-url";

// T59：sitemap.xml。
// - 商品用 anon client 撈（RLS 公開讀已限 status='active'，query 再明示一次），
//   下架／封存商品自然不進 sitemap。
// - 品類頁只列「實際有上架商品」的品類——與 collections tab 點亮邏輯同準則，
//   且直接從同一次商品查詢推導，不另發存在性探測。
// - preview 不用特別擋：robots.ts 在非 production 已全站 Disallow。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const supabase = await createClient();

  const { data: products, error } = await supabase
    .from("product")
    .select("slug, category, updated_at")
    .eq("status", "active");

  // §6：查詢失敗 ≠ 沒有商品——寧可讓 sitemap 回 500 由搜尋引擎稍後重抓，
  // 也不要回一份「只剩首頁」的 sitemap 誤導爬蟲把商品頁當已移除。
  if (error) {
    throw new Error(`sitemap 商品查詢失敗：${error.message}`);
  }

  const entries: MetadataRoute.Sitemap = [
    {
      url: new URL("/", base).toString(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  const categoriesWithProducts = [...new Set(products.map((p) => p.category))];
  for (const category of categoriesWithProducts) {
    entries.push({
      url: new URL(`/collections/${category}`, base).toString(),
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }

  for (const product of products) {
    entries.push({
      url: new URL(`/products/${product.slug}`, base).toString(),
      lastModified: new Date(product.updated_at),
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  return entries;
}
