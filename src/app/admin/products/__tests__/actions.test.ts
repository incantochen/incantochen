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

const state = {
  insertError: null as { code?: string; message?: string } | null,
  insertedId: "new-product-id",
  updateError: null as { code?: string; message?: string } | null,
}

const recorded: { op: string; table: string; values?: any; id?: string }[] = []

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: (values: any) => {
        recorded.push({ op: "insert", table, values })
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
        const entry = { op: "update", table, values } as (typeof recorded)[number]
        recorded.push(entry)
        return {
          eq: (_col: string, id: string) => {
            entry.id = id
            return Promise.resolve({ error: state.updateError })
          },
        }
      },
    }),
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

beforeEach(() => {
  vi.clearAllMocks()
  recorded.length = 0
  state.insertError = null
  state.insertedId = "new-product-id"
  state.updateError = null
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

  it("creates product and revalidates list on success", async () => {
    const result = await createProduct(VALID_VALUES)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.id).toBe("new-product-id")
    }
    expect(recorded).toEqual([
      { op: "insert", table: "product", values: VALID_VALUES },
    ])
    expect(revalidatePath).toHaveBeenCalledWith("/admin/products")
  })

  it("maps slug unique-constraint violation (23505) to a field error", async () => {
    state.insertError = { code: "23505", message: "duplicate key" }
    const result = await createProduct(VALID_VALUES)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.slug).toMatch(/已被使用/)
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
    await updateProduct("product-1", VALID_VALUES)
    expect(requireAdmin).toHaveBeenCalled()
  })

  it("rejects invalid input without writing", async () => {
    const result = await updateProduct("product-1", { ...VALID_VALUES, category: "invalid" as any })
    expect(result.ok).toBe(false)
    expect(recorded).toHaveLength(0)
  })

  it("updates product and revalidates affected paths", async () => {
    const result = await updateProduct("product-1", VALID_VALUES)
    expect(result.ok).toBe(true)
    expect(recorded).toEqual([
      { op: "update", table: "product", values: VALID_VALUES, id: "product-1" },
    ])
    expect(revalidatePath).toHaveBeenCalledWith("/admin/products")
    expect(revalidatePath).toHaveBeenCalledWith("/admin/products/product-1")
    expect(revalidatePath).toHaveBeenCalledWith(`/products/${VALID_VALUES.slug}`)
  })

  it("maps slug unique-constraint violation (23505) to a field error", async () => {
    state.updateError = { code: "23505", message: "duplicate key" }
    const result = await updateProduct("product-1", VALID_VALUES)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.slug).toMatch(/已被使用/)
    }
  })
})
