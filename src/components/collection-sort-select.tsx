"use client"

import { useRouter, usePathname } from "next/navigation"

const SORT_OPTIONS = [
  { value: "featured", label: "推薦" },
  { value: "price_asc", label: "價格低→高" },
  { value: "price_desc", label: "價格高→低" },
  { value: "newest", label: "最新" },
] as const

export function CollectionSortSelect({ value }: { value: string }) {
  const router = useRouter()
  const pathname = usePathname()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    router.push(next === "featured" ? pathname : `${pathname}?sort=${next}`)
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
    >
      {SORT_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          排序：{o.label}
        </option>
      ))}
    </select>
  )
}
