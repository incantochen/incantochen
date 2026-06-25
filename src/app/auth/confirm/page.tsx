"use client"

import { useState, useTransition, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import type { EmailOtpType } from "@supabase/supabase-js"
import { confirmMagicLink } from "./actions"

function ConfirmContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null

  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleConfirm() {
    if (!tokenHash || !type) return
    setError(null)
    startTransition(async () => {
      const result = await confirmMagicLink(tokenHash, type)
      if (result.ok) {
        router.push("/")
      } else {
        setError(result.error)
      }
    })
  }

  if (!tokenHash || !type) {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <p className="text-destructive">連結格式不正確。</p>
        <Link href="/login" className="mt-2 inline-block text-primary underline underline-offset-2">
          回登入頁
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-heading text-[28px] text-ink">確認登入</h1>
      <p className="mt-3 text-sm text-ash">請按下方按鈕完成登入。</p>
      <button
        type="button"
        disabled={isPending}
        onClick={handleConfirm}
        className="mt-6 w-full rounded-[2px] bg-primary px-8 py-4 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase hover:bg-primary-700 disabled:opacity-60"
      >
        {isPending ? "登入中…" : "登入"}
      </button>
      {error && (
        <div className="mt-3">
          <p className="text-sm text-destructive">{error}</p>
          <Link href="/login" className="text-primary underline underline-offset-2">
            重新寄送登入信
          </Link>
        </div>
      )}
    </div>
  )
}

export default function ConfirmPage() {
  return (
    <Suspense>
      <ConfirmContent />
    </Suspense>
  )
}
