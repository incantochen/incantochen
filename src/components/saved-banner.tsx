"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { formatDateTime } from "@/lib/utils"

// 儲存後的一次性提示：帶著 ?saved=1&affected=N 導航過來才會顯示，幾秒後自動
// 把網址上的這兩個 query 清掉。用瀏覽器原生 history.replaceState 而非
// router.replace()——後者是一次 Next.js 導航，會再打一次伺服器換一輪 RSC
// payload，單純清網址列文字不需要為此多付一次 round trip。呼叫端在每次
// 儲存都給這個元件不同的 key（見 [id]/page.tsx），確保這裡的 4 秒計時器
// 每次儲存都重新開始，不會被上一次儲存的計時器提早關掉。
export function SavedBanner({
  affectedRows,
  updatedAt,
}: {
  affectedRows: number
  updatedAt: string
}) {
  const pathname = usePathname()

  useEffect(() => {
    const timer = setTimeout(() => {
      window.history.replaceState(null, "", pathname)
    }, 4000)
    return () => clearTimeout(timer)
  }, [pathname])

  return (
    <div className="mb-4 rounded border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
      已儲存 ・ 更新時間：{formatDateTime(updatedAt)} ・ 更新 {affectedRows} 筆
      {affectedRows === 0 && "（欄位內容與原本相同，未寫入）"}
    </div>
  )
}
