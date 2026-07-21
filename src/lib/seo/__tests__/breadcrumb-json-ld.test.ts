import { describe, expect, it, vi } from "vitest";

// breadcrumb-json-ld.ts import "server-only"（node 測試環境會 throw）＋
// getSiteUrl 走 serverEnv——比照 ecpay 測試的做法各自 mock 掉。
vi.mock("server-only", () => ({}));
vi.mock("@/lib/seo/site-url", () => ({
  getSiteUrl: () => new URL("https://shop.example.com"),
}));

import { buildBreadcrumbJsonLd } from "../breadcrumb-json-ld";

describe("buildBreadcrumbJsonLd", () => {
  it("PDP 三層（末項無 href）全部保留、item 為絕對網址、末項省略 item", () => {
    const result = buildBreadcrumbJsonLd([
      { label: "首頁", href: "/" },
      { label: "戒指", href: "/collections/ring" },
      { label: "單石戒指" },
    ]);
    expect(result.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "首頁",
        item: "https://shop.example.com/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "戒指",
        item: "https://shop.example.com/collections/ring",
      },
      { "@type": "ListItem", position: 3, name: "單石戒指" },
    ]);
  });

  it("品類頁：中間項無 href（「商品」）被丟棄、position 重排，避免產生無效標記", () => {
    const result = buildBreadcrumbJsonLd([
      { label: "首頁", href: "/" },
      { label: "商品" }, // 無著陸頁 → 非末項無 href，須丟棄
      { label: "戒指系列" },
    ]);
    expect(result.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "首頁",
        item: "https://shop.example.com/",
      },
      { "@type": "ListItem", position: 2, name: "戒指系列" },
    ]);
    // 保留下來的每個非末項都必帶 item（Google BreadcrumbList 必填）
    const kept = result.itemListElement;
    kept.slice(0, -1).forEach((li) => {
      expect(li).toHaveProperty("item");
    });
  });

  it("末項即使無 href 也保留（目前頁，item 可省略）", () => {
    const result = buildBreadcrumbJsonLd([{ label: "只有一層" }]);
    expect(result.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "只有一層" },
    ]);
  });
});
