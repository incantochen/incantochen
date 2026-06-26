"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Gem } from "lucide-react"
import { updateCartItemQuantity, removeCartItem } from "@/app/cart/actions"
import type { CartItemView } from "@/lib/cart/read-cart"

export function CartItemRow({ item }: { item: CartItemView }) {
  const [quantity, setQuantity] = useState(item.quantity)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function changeQuantity(next: number) {
    if (next < 1) return
    setQuantity(next)
    setError(null)
    startTransition(async () => {
      const result = await updateCartItemQuantity(item.id, next)
      if (!result.ok) {
        setQuantity(item.quantity)
        setError(result.error)
      }
    })
  }

  function handleRemove() {
    setError(null)
    startTransition(async () => {
      const result = await removeCartItem(item.id)
      if (!result.ok) {
        setError(result.error)
      }
    })
  }

  return (
    <div className="grid grid-cols-[90px_1fr_auto] items-center gap-4 border-b border-border py-5">
      <div className="flex h-[90px] w-[90px] items-center justify-center rounded-lg border border-border bg-cloud">
        <Gem className="size-8 text-ash/60" strokeWidth={1.2} />
      </div>
      <div>
        <div className="text-[10.5px] tracking-[0.16em] text-ash uppercase">
          {item.selectionsSummary}
        </div>
        <Link
          href={`/products/${item.productSlug}`}
          className="mt-0.5 block font-heading text-lg text-ink hover:text-primary"
        >
          {item.productName}
        </Link>
        <div className="mt-2 flex items-center gap-4">
          <div className="inline-flex items-center overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              disabled={isPending || quantity <= 1}
              onClick={() => changeQuantity(quantity - 1)}
              className="flex h-8 w-8 items-center justify-center text-primary disabled:opacity-40"
            >
              −
            </button>
            <span className="w-9 text-center text-sm">{quantity}</span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => changeQuantity(quantity + 1)}
              className="flex h-8 w-8 items-center justify-center text-primary disabled:opacity-40"
            >
              +
            </button>
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={handleRemove}
            className="text-sm text-destructive underline underline-offset-2 disabled:opacity-40"
          >
            移除
          </button>
        </div>
        {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
      </div>
      <div className="text-right font-medium text-primary">
        NT$ {(item.unitPriceSnapshot * quantity).toLocaleString()}
      </div>
    </div>
  )
}
