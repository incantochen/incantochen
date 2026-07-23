// 前台導覽品類連結的單一出處：桌機 header（HeaderChrome）與手機選單
// （MobileNav）共用，避免兩處各自維護。
//
// ⚠️ 墜子(Pendant) 不在 product_category enum（ring/earring/bracelet/necklace），
// 暫以 "#" placeholder；要能導向需先新增品類（migration）。其餘四項對應現有品類
// 路由——品類無商品時 collections 頁會顯示「即將推出」，不會 404。
export type CategoryNavLink = {
  zh: string
  en: string
  href: string
}

export const CATEGORY_NAV: CategoryNavLink[] = [
  { zh: "戒指", en: "Ring", href: "/collections/ring" },
  { zh: "項鍊", en: "Necklace", href: "/collections/necklace" },
  { zh: "墜子", en: "Pendant", href: "#" },
  { zh: "耳環", en: "Earring", href: "/collections/earring" },
  { zh: "手鍊/手環", en: "Bracelet", href: "/collections/bracelet" },
]
