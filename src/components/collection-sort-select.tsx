"use client"

import { useTransition } from "react"
import { useRouter, usePathname } from "next/navigation"
import { SORT_OPTIONS, type SortKey } from "@/lib/product/collection-sort"

export function CollectionSortSelect({ value }: { value: SortKey }) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    // 排序是「調整目前這次瀏覽的檢視方式」而非導向新頁面，用 replace 才不會
    // 讓每次改排序都佔一筆瀏覽紀錄（按上一頁會被迫先倒轉排序歷史）。
    // startTransition 讓 isPending 在這段導航期間為 true，即時給出「處理中」
    // 回饋——searchParams-only 的導航不會觸發 loading.tsx 的 Suspense 邊界。
    startTransition(() => {
      router.replace(next === "featured" ? pathname : `${pathname}?sort=${next}`)
    })
  }

  return (
    <select
      aria-label="排序方式"
      value={value}
      onChange={handleChange}
      disabled={isPending}
      className="rounded-lg border border-border bg-white px-3 py-2 text-sm disabled:opacity-60"
    >
      {SORT_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          排序：{o.label}
        </option>
      ))}
    </select>
  )
}
