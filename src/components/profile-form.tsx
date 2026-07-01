"use client"

import { useState, useTransition } from "react"
import { profileFormSchema } from "@/lib/account/schema"
import { updateProfile } from "@/app/account/profile/actions"

export function ProfileForm({ email, name: initialName }: { email: string; name: string }) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function validate() {
    const result = profileFormSchema.safeParse({ name })
    if (result.success) {
      setError(null)
      return true
    }
    setError(result.error.issues[0]?.message ?? "姓名格式不正確")
    return false
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    setSubmitError(null)
    setSuccess(false)
    if (!validate()) return
    startTransition(async () => {
      const result = await updateProfile(name)
      if (result.ok) {
        setSuccess(true)
      } else {
        setSubmitError(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">Email</label>
        <input
          type="email"
          value={email}
          readOnly
          className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none read-only:bg-cloud"
        />
      </div>

      <div className="mb-5">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">姓名</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={validate}
          className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
        />
        {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
      </div>

      {success && <p className="mb-3 text-sm text-success">已更新</p>}
      {submitError && <p className="mb-3 text-sm text-destructive">{submitError}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-[2px] bg-primary px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase disabled:opacity-50"
      >
        {isPending ? "儲存中…" : "儲存"}
      </button>
    </form>
  )
}
