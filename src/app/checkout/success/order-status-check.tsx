"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

const POLL_INTERVAL_MS = 3000
// T118：90 秒 timeout 後不再完全停止，降頻續 poll。router.refresh() 會連根
// layout 一起向伺服器重取（繞過 Router Cache），是 SiteHeader 購物袋徽章在
// webhook 清空購物車後歸零的唯一客戶端管道——若 timeout 即停（舊行為），
// webhook 遲到（本機驗收手動模擬、或 production 罕見延遲）時訂單狀態與
// 徽章都會卡在舊值，直到下一次完整頁面載入。
const SLOW_POLL_INTERVAL_MS = 15_000
const TIMEOUT_MS = 90_000

export function OrderStatusCheck() {
  const router = useRouter()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    // timedOut 翻轉時本 effect 重跑：清掉 3 秒快輪、換 15 秒慢輪。訂單一旦
    // 確認付款，頁面改渲染 paid 分支、本元件卸載，輪詢自然停止。
    const interval = setInterval(
      () => {
        router.refresh()
      },
      timedOut ? SLOW_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
    )
    return () => clearInterval(interval)
  }, [router, timedOut])

  if (timedOut) {
    return (
      <p className="text-sm text-ash mb-6">
        款項確認中，確認後將以 email 通知您
      </p>
    )
  }

  return (
    <p className="text-sm text-ash mb-6">
      <span className="inline-block h-2 w-2 rounded-full bg-amber-400 mr-2 animate-pulse align-middle" />
      正在確認中，請勿關閉此頁面…
    </p>
  )
}
