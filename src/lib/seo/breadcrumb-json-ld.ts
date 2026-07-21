import "server-only";
import { getSiteUrl } from "@/lib/seo/site-url";

// BreadcrumbList JSON-LD builder：吃與視覺元件 <Breadcrumb>（components/
// breadcrumb.tsx）相同形狀的 items，兩者在頁面共用同一個陣列，避免視覺
// 麵包屑與結構化資料各寫一份而失同步。
// 末項（目前頁）依 schema.org 慣例可不帶 item URL。

export type BreadcrumbJsonLdItem = {
  label: string;
  href?: string;
};

export function buildBreadcrumbJsonLd(items: BreadcrumbJsonLdItem[]) {
  const base = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href ? { item: new URL(item.href, base).toString() } : {}),
    })),
  };
}
