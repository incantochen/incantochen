import "server-only";
import { getSiteUrl } from "@/lib/seo/site-url";

// BreadcrumbList JSON-LD builder：吃與視覺元件 <Breadcrumb>（components/
// breadcrumb.tsx）相同形狀的 items，兩者在頁面共用同一個陣列，避免視覺
// 麵包屑與結構化資料各寫一份而失同步。
//
// schema.org／Google 規範：BreadcrumbList 除「最末項（目前頁）」外，每個
// ListItem 的 item（URL）都是必填；中間項缺 item 會讓整組 BreadcrumbList
// 被判無效、rich result 整個不顯示。視覺麵包屑允許無連結的中間層級
// （如品類頁的「商品」沒有對應著陸頁），故這裡「丟掉非末項且無 href 的
// 項目」再重排 position——輸出恆為合法標記，視覺麵包屑不受影響。

export type BreadcrumbJsonLdItem = {
  label: string;
  href?: string;
};

export function buildBreadcrumbJsonLd(items: BreadcrumbJsonLdItem[]) {
  const base = getSiteUrl();
  // 末項一律保留（目前頁，item 可省略）；其餘僅保留有 href 者，再重排 position。
  const valid = items.filter(
    (item, i) => i === items.length - 1 || Boolean(item.href),
  );
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: valid.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href ? { item: new URL(item.href, base).toString() } : {}),
    })),
  };
}
