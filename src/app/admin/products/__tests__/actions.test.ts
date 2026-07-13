/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const revalidatePath = vi.fn()
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}))

const requireAdmin = vi.fn().mockResolvedValue({ email: "admin@example.com" })
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
}))

const CURRENT_UPDATED_AT = "2026-01-01T00:00:00Z"

const state = {
  insertError: null as { code?: string; message?: string } | null,
  insertedId: "new-product-id",
  updateError: null as { code?: string; message?: string } | null,
  // 空陣列＝ CAS 守衛沒命中任何列（id 不存在或 updated_at 已被異動）
  updateMatched: [{ id: "product-1" }] as { id: string }[] | null,
  // no-op 路徑用來確認資料沒有在使用者瀏覽期間被別人異動過
  currentUpdatedAt: CURRENT_UPDATED_AT as string | null,
  currentUpdatedAtError: null as { message?: string } | null,
  // 品類變更守衛：這個商品目前掛了幾筆 product_option
  optionCount: 0,
  optionCountError: null as { message?: string } | null,
  // slug 衝突時查到的既有商品（null＝查不到，走通用訊息）
  conflictProduct: null as { name: string; status: string } | null,
}

const recorded: { op: string; table: string; values?: any; eqs: [string, string][] }[] = []

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "product_option") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({ count: state.optionCount, error: state.optionCountError }),
          }),
        }
      }

      // table === "product"
      return {
        insert: (values: any) => {
          recorded.push({ op: "insert", table, values, eqs: [] })
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: state.insertError ? null : { id: state.insertedId },
                  error: state.insertError,
                }),
            }),
          }
        },
        update: (values: any) => {
          const entry = { op: "update", table, values, eqs: [] as [string, string][] }
          recorded.push(entry)
          const chain = {
            eq: (col: string, val: string) => {
              entry.eqs.push([col, val])
              return chain
            },
            select: () =>
              Promise.resolve({
                data: state.updateError ? null : state.updateMatched,
                error: state.updateError,
              }),
          }
          return chain
        },
        select: (cols: string) => {
          if (cols === "updated_at") {
            // no-op 路徑的 drift 檢查
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: state.currentUpdatedAtError
                      ? null
                      : state.currentUpdatedAt === null
                        ? null
                        : { updated_at: state.currentUpdatedAt },
                    error: state.currentUpdatedAtError,
                  }),
              }),
            }
          }
          // slug 衝突查詢：select("name, status").eq("slug", slug).maybeSingle()
          return {
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.conflictProduct, error: null }),
            }),
          }
        },
      }
    },
  }),
}))

import { createProduct, updateProduct } from "../actions"

const VALID_VALUES = {
  slug: "emerald-solitaire-ring",
  name: "祖母綠單石戒指",
  category: "ring" as const,
  base_price: 25000,
  status: "draft" as const,
}

const ORIGINAL = VALID_VALUES
const GUARD = { values: ORIGINAL, updatedAt: CURRENT_UPDATED_AT }

beforeEach(() => {
  vi.clearAllMocks()
  recorded.length = 0
  state.insertError = null
  state.insertedId = "new-product-id"
  state.updateError = null
  state.updateMatched = [{ id: "product-1" }]
  state.currentUpdatedAt = CURRENT_UPDATED_AT
  state.currentUpdatedAtError = null
  state.optionCount = 0
  state.optionCountError = null
  state.conflictProduct = null
})

describe("createProduct", () => {
  it("requires admin", async () => {
    await createProduct(VALID_VALUES)
    expect(requireAdmin).toHaveBeenCalled()
  })

  it("rejects invalid slug format", async () => {
    const result = await createProduct({ ...VALID_VALUES, slug: "Not A Slug!" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.slug).toBeTruthy()
    }
    expect(recorded).toHaveLength(0)
  })

  it("rejects negative base_price", async () => {
    const result = await createProduct({ ...VALID_VALUES, base_price: -100 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.base_price).toBeTruthy()
    }
  })

  it("rejects empty name", async () => {
    const result = await createProduct({ ...VALID_VALUES, name: "  " })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.name).toBeTruthy()
    }
  })

  it("rejects NaN base_price (clearing the price input) instead of silently accepting 0", async () => {
    const result = await createProduct({ ...VALID_VALUES, base_price: NaN })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.base_price).toBeTruthy()
    }
    expect(recorded).toHaveLength(0)
  })

  it("creates product and revalidates list on success", async () => {
    const result = await createProduct(VALID_VALUES)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.id).toBe("new-product-id")
    }
    expect(recorded).toEqual([
      { op: "insert", table: "product", values: VALID_VALUES, eqs: [] },
    ])
    expect(revalidatePath).toHaveBeenCalledWith("/admin/products")
  })

  it("maps slug unique-constraint violation (23505) to a generic error when the conflicting product can't be looked up", async () => {
    state.insertError = { code: "23505", message: "duplicate key" }
    const result = await createProduct(VALID_VALUES)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.slug).toMatch(/已被使用/)
    }
  })

  it("maps slug unique-constraint violation (23505) to a message naming the conflicting product", async () => {
    state.insertError = { code: "23505", message: "duplicate key" }
    state.conflictProduct = { name: "舊款戒指", status: "archived" }
    const result = await createProduct(VALID_VALUES)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.slug).toContain("舊款戒指")
      expect(result.fieldErrors?.slug).toContain("已封存")
    }
  })

  it("maps other DB errors to a generic failure message", async () => {
    state.insertError = { code: "XXYYY", message: "connection reset" }
    const result = await createProduct(VALID_VALUES)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/建立商品失敗/)
    }
  })
})

describe("updateProduct", () => {
  it("requires admin", async () => {
    await updateProduct("product-1", { ...VALID_VALUES, base_price: 30000 }, GUARD)
    expect(requireAdmin).toHaveBeenCalled()
  })

  it("rejects invalid input without writing", async () => {
    const result = await updateProduct(
      "product-1",
      { ...VALID_VALUES, category: "invalid" as any },
      GUARD,
    )
    expect(result.ok).toBe(false)
    expect(recorded).toHaveLength(0)
  })

  it("does not write to the DB and reports affectedRows:0 when nothing changed and the record hasn't drifted", async () => {
    const result = await updateProduct("product-1", { ...VALID_VALUES }, GUARD)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.affectedRows).toBe(0)
    }
    expect(recorded).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("reports a race error (not false success) when resubmitting unchanged values against a row that drifted since page load", async () => {
    state.currentUpdatedAt = "2026-02-02T00:00:00Z" // 別人已經動過這筆資料
    const result = await updateProduct("product-1", { ...VALID_VALUES }, GUARD)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/已被其他管理員異動/)
    }
  })

  it("updates product with a CAS guard on updated_at (not just status) and revalidates affected paths", async () => {
    const changed = { ...VALID_VALUES, base_price: 30000 }
    const result = await updateProduct("product-1", changed, GUARD)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.affectedRows).toBe(1)
    }
    expect(recorded).toEqual([
      {
        op: "update",
        table: "product",
        values: changed,
        eqs: [
          ["id", "product-1"],
          ["updated_at", CURRENT_UPDATED_AT],
        ],
      },
    ])
    expect(revalidatePath).toHaveBeenCalledWith("/admin/products")
    expect(revalidatePath).toHaveBeenCalledWith("/admin/products/product-1")
    expect(revalidatePath).toHaveBeenCalledWith(`/products/${VALID_VALUES.slug}`)
  })

  it("still catches a lost-update race when two edits touch different, non-status fields (updated_at guard, not status-only)", async () => {
    // 兩個分頁都沒改 status，只改了不同欄位——舊版只比 status 的 CAS 守衛會
    // 讓這種情況矇混過去；新版比 updated_at，任何一方先寫入都會讓對方的
    // updated_at guard 失效（此處直接用 updateMatched:[] 模擬第二個分頁的
    // UPDATE 命中 0 列）。
    state.updateMatched = []
    const changed = { ...VALID_VALUES, name: "改個名字" }
    const result = await updateProduct("product-1", changed, GUARD)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/已被其他管理員異動/)
    }
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("maps slug unique-constraint violation (23505) to a message naming the conflicting product", async () => {
    state.updateError = { code: "23505", message: "duplicate key" }
    state.conflictProduct = { name: "另一款戒指", status: "active" }
    const result = await updateProduct("product-1", { ...VALID_VALUES, base_price: 30000 }, GUARD)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.slug).toContain("另一款戒指")
    }
  })

  it("reports a race error instead of false success when the CAS guard matches zero rows", async () => {
    state.updateMatched = []
    const result = await updateProduct("product-1", { ...VALID_VALUES, base_price: 30000 }, GUARD)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/已被其他管理員異動/)
    }
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("allows saving unrelated fields when slug is unchanged even if it predates the new format rule", async () => {
    const legacySlug = "Legacy_Slug 1"
    const legacyOriginal = { ...VALID_VALUES, slug: legacySlug }
    const result = await updateProduct(
      "product-1",
      { ...legacyOriginal, base_price: 30000 },
      { values: legacyOriginal, updatedAt: CURRENT_UPDATED_AT },
    )
    expect(result.ok).toBe(true)
  })

  it("still enforces slug format when slug is actually changed", async () => {
    const result = await updateProduct(
      "product-1",
      { ...VALID_VALUES, slug: "Not A Slug!" },
      GUARD,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.slug).toBeTruthy()
    }
  })

  it("rejects a category change when the product already has configurator options attached", async () => {
    state.optionCount = 3
    const result = await updateProduct(
      "product-1",
      { ...VALID_VALUES, category: "earring" },
      GUARD,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.category).toBeTruthy()
    }
    expect(recorded.filter((r) => r.op === "update")).toHaveLength(0)
  })

  it("allows a category change when the product has no configurator options attached", async () => {
    state.optionCount = 0
    const result = await updateProduct(
      "product-1",
      { ...VALID_VALUES, category: "earring" },
      GUARD,
    )
    expect(result.ok).toBe(true)
  })
})
