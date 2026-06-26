"use client"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

const POLL_INTERVAL_MS = 3000
const TIMEOUT_MS = 90_000

export function OrderStatusCheck() {
  const router = useRouter()
  const startRef = useRef(0)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    startRef.current = Date.now()
    const interval = setInterval(() => {
      if (Date.now() - startRef.current >= TIMEOUT_MS) {
        clearInterval(interval)
        setTimedOut(true)
        return
      }
      router.refresh()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [router])

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
