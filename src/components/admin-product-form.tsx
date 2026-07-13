"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createProduct, updateProduct } from "@/app/admin/products/actions"
import type { ProductFormValues } from "@/lib/product/schema"
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/product/category"
import { ALL_PRODUCT_STATUSES, PRODUCT_STATUS_LABELS } from "@/lib/product/product-status"

type Props =
  | { mode: "create" }
  | {
      mode: "edit"
      productId: string
      initialValues: ProductFormValues
      updatedAt: string
      hasConfiguredOptions: boolean
    }

export function AdminProductForm(props: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof ProductFormValues, string>>
  >({})

  const initial: ProductFormValues =
    props.mode === "edit"
      ? props.initialValues
      : { slug: "", name: "", category: "ring", base_price: 0, status: "draft" }

  const [values, setValues] = useState<ProductFormValues>(initial)

  function update<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})

    startTransition(async () => {
      const result =
        props.mode === "create"
          ? await createProduct(values)
          : await updateProduct(props.productId, values, {
              values: props.initialValues,
              updatedAt: props.updatedAt,
            })

      if (!result.ok) {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }

      router.push(`/admin/products/${result.id}?saved=1&affected=${result.affectedRows}`)
    })
  }

  const inputClass =
    "border border-gray-300 rounded px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-gray-400"

  const categoryLocked = props.mode === "edit" && props.hasConfiguredOptions

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded text-sm">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-600 mb-1">商品名稱</label>
        <input
          type="text"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          className={inputClass}
        />
        {fieldErrors.name && <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>}
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1">網址代稱（slug）</label>
        <input
          type="text"
          value={values.slug}
          onChange={(e) => update("slug", e.target.value)}
          placeholder="emerald-solitaire-ring"
          className={`${inputClass} font-mono`}
        />
        {fieldErrors.slug && <p className="mt-1 text-xs text-red-600">{fieldErrors.slug}</p>}
        {props.mode === "edit" && (
          <p className="mt-1 text-xs text-gray-400">變更 slug 會讓舊網址（含分享出去的連結）失效。</p>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1">品類</label>
        <select
          value={values.category}
          disabled={categoryLocked}
          onChange={(e) => update("category", e.target.value as ProductFormValues["category"])}
          className={`${inputClass} disabled:bg-gray-100 disabled:text-gray-400`}
        >
          {ALL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        {fieldErrors.category && <p className="mt-1 text-xs text-red-600">{fieldErrors.category}</p>}
        {categoryLocked && (
          <p className="mt-1 text-xs text-gray-400">
            已設定配置器選項，無法變更品類（避免與選項白名單脫鉤）。
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1">底價（NT$）</label>
        <input
          type="number"
          min={0}
          step={1}
          value={Number.isNaN(values.base_price) ? "" : values.base_price}
          onChange={(e) => update("base_price", e.target.valueAsNumber)}
          className={inputClass}
        />
        {fieldErrors.base_price && (
          <p className="mt-1 text-xs text-red-600">{fieldErrors.base_price}</p>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1">狀態</label>
        <select
          value={values.status}
          onChange={(e) => update("status", e.target.value as ProductFormValues["status"])}
          className={inputClass}
        >
          {ALL_PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PRODUCT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {fieldErrors.status && <p className="mt-1 text-xs text-red-600">{fieldErrors.status}</p>}
        <p className="mt-1 text-xs text-gray-400">
          商品一旦有訂單引用即無法刪除，下架請改選「已封存」。
        </p>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
      >
        {isPending ? "儲存中…" : props.mode === "create" ? "建立商品" : "儲存變更"}
      </button>
    </form>
  )
}
