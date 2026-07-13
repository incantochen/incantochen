"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { formatDateTime } from "@/lib/utils"

// 儲存後的一次性提示：帶著 ?saved=1&affected=N 導航過來才會顯示，幾秒後自動
// 把網址上的這兩個 query 清掉（router.replace 不留歷史紀錄），單純重新整理
// 頁面就不會再看到同一則提示。
export function SavedBanner({
  affectedRows,
  updatedAt,
}: {
  affectedRows: number
  updatedAt: string
}) {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace(pathname)
    }, 4000)
    return () => clearTimeout(timer)
  }, [router, pathname])

  return (
    <div className="mb-4 rounded border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
      已儲存 ・ 更新時間：{formatDateTime(updatedAt)} ・ 更新 {affectedRows} 筆
      {affectedRows === 0 && "（欄位內容與原本相同，未寫入）"}
    </div>
  )
}
