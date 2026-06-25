"use client"

import { useState } from "react"
import { checkoutFormSchema } from "@/lib/checkout/schema"

export function CheckoutForm({ defaultEmail }: { defaultEmail: string }) {
  const [email, setEmail] = useState(defaultEmail)
  const [recipientName, setRecipientName] = useState("")
  const [recipientPhone, setRecipientPhone] = useState("")
  const [zipCode, setZipCode] = useState("")
  const [shippingAddress, setShippingAddress] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  function validate() {
    const result = checkoutFormSchema.safeParse({
      email,
      recipientName,
      recipientPhone,
      zipCode,
      shippingAddress,
    })
    if (result.success) {
      setErrors({})
      return true
    }
    const fieldErrors: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const key = issue.path[0]
      if (typeof key === "string" && !fieldErrors[key]) {
        fieldErrors[key] = issue.message
      }
    }
    setErrors(fieldErrors)
    return false
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        validate()
      }}
    >
      <div className="mb-4">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">Email</label>
        <input
          type="email"
          value={email}
          readOnly={!!defaultEmail}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={validate}
          className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary read-only:bg-cloud"
        />
        {errors.email && <p className="mt-1 text-sm text-destructive">{errors.email}</p>}
      </div>

      <div className="mb-4">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">收件人姓名</label>
        <input
          type="text"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          onBlur={validate}
          className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
        />
        {errors.recipientName && (
          <p className="mt-1 text-sm text-destructive">{errors.recipientName}</p>
        )}
      </div>

      <div className="mb-4">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">電話</label>
        <input
          type="tel"
          value={recipientPhone}
          onChange={(e) => setRecipientPhone(e.target.value)}
          onBlur={validate}
          className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
        />
        {errors.recipientPhone && (
          <p className="mt-1 text-sm text-destructive">{errors.recipientPhone}</p>
        )}
      </div>

      <div className="mb-4 grid grid-cols-[120px_1fr] gap-3">
        <div>
          <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
            郵遞區號
          </label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={5}
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ""))}
            onBlur={validate}
            className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
          />
          {errors.zipCode && <p className="mt-1 text-sm text-destructive">{errors.zipCode}</p>}
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">地址</label>
          <input
            type="text"
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            onBlur={validate}
            className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
          />
          {errors.shippingAddress && (
            <p className="mt-1 text-sm text-destructive">{errors.shippingAddress}</p>
          )}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">配送方式</label>
        <div className="mt-2 rounded-lg border border-border bg-cloud px-3.5 py-3 text-sm">
          黑貓宅配（保價＋本人簽收）
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-border bg-cloud px-3.5 py-3 text-sm">
        ⓘ <strong>下單後為妳訂製</strong>，交期至少 <strong>XX</strong> 天，將於結帳再次告知。
      </div>

      <button
        type="submit"
        disabled
        title="結帳功能即將推出（T23 建立訂單尚未完成）"
        className="w-full rounded-[2px] bg-primary px-8 py-4 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase disabled:opacity-50"
      >
        前往付款
      </button>
    </form>
  )
}
