export const SORT_OPTIONS = [
  { value: "featured", label: "推薦" },
  { value: "price_asc", label: "價格低→高" },
  { value: "price_desc", label: "價格高→低" },
  { value: "newest", label: "最新" },
] as const

export type SortKey = (typeof SORT_OPTIONS)[number]["value"]

// 由 SORT_OPTIONS 衍生（而非另外手key一份），避免 page.tsx 的驗證清單與
// collection-sort-select.tsx 的下拉選單各自維護、日後新增排序方式漏改一邊。
export const ALL_SORT_KEYS = SORT_OPTIONS.map((o) => o.value) as SortKey[]
