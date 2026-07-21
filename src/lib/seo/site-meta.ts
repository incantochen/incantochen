// 站台名稱／文案與 OpenGraph 基底的單一出處（root layout 與各頁 generateMetadata
// 共用）。純常數，不 import server-only，client/server 皆可用。

export const SITE_NAME = "incantochen";
export const SITE_TITLE = "incantochen｜半客製彩色寶石飾品";
export const SITE_DESCRIPTION =
  "incantochen 高端半客製彩色寶石飾品——戒指、耳環、手鍊、項鍊。以彩色寶石為主角，選妳的寶石顏色、金屬與尺寸，即時計價、下單後專屬訂製。";

// ⚠️ Next.js metadata 的 openGraph 是「整個物件淺層取代」而非逐欄深合併：子頁
// 的 generateMetadata 若只給 title/description/url，會把 root layout openGraph 的
// siteName／locale／type 整組蓋掉（商品頁／品類頁是最重要的可分享頁，卻反而少
// 了品牌名與語系）。故子頁一律透過本 helper 帶回這些基底欄位。
export function pageOpenGraph(overrides: {
  title: string;
  description: string;
  url: string;
}) {
  return {
    type: "website" as const,
    locale: "zh_TW",
    siteName: SITE_NAME,
    ...overrides,
  };
}
