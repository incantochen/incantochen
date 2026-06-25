"use client"

import { useState } from "react"

export type ConfiguratorOption = {
  id: string
  name: string
  values: { id: string; label: string; isDefault: boolean }[]
}

function defaultSelection(options: ConfiguratorOption[]) {
  const initial: Record<string, string> = {}
  for (const option of options) {
    const defaultValue = option.values.find((value) => value.isDefault) ?? option.values[0]
    if (defaultValue) {
      initial[option.id] = defaultValue.id
    }
  }
  return initial
}

export function ProductConfigurator({ options }: { options: ConfiguratorOption[] }) {
  const [selected, setSelected] = useState(() => defaultSelection(options))
  const [quantity, setQuantity] = useState(1)

  return (
    <div>
      {options.map((option, index) => (
        <div key={option.id} className="py-4">
          <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
            {String(index + 1).padStart(1, "0")}. {option.name}
          </label>
          <div className="mt-2 flex flex-wrap gap-2.5">
            {option.values.map((value) => {
              const isSelected = selected[option.id] === value.id
              return (
                <button
                  key={value.id}
                  type="button"
                  onClick={() =>
                    setSelected((prev) => ({ ...prev, [option.id]: value.id }))
                  }
                  className={
                    isSelected
                      ? "inline-flex items-center gap-2 rounded-lg border border-primary px-3.5 py-2 text-sm ring-2 ring-secondary-400"
                      : "inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm hover:border-ash"
                  }
                >
                  {value.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="py-4">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">數量</label>
        <div className="mt-2 inline-flex items-center overflow-hidden rounded-lg border border-border">
          <button
            type="button"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="flex h-10 w-10 items-center justify-center text-lg text-primary disabled:opacity-40"
          >
            −
          </button>
          <span className="w-12 text-center text-sm">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => q + 1)}
            className="flex h-10 w-10 items-center justify-center text-lg text-primary"
          >
            +
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-cloud px-3.5 py-3 text-sm">
        ⓘ <strong>下單後為妳訂製</strong>，交期至少 <strong>XX</strong> 天，將於結帳再次告知。
      </div>

      <button
        type="button"
        className="mt-5 w-full rounded-[2px] bg-primary px-8 py-4 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase hover:bg-primary-700"
      >
        加入購物袋
      </button>
    </div>
  )
}
