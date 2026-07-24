/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

// order-shipped/refunded-notification、issue-invoice 等在模組頂層 import serverEnv
//（env.server 載入即 fail-fast 驗證必填變數）——給空物件讓整條 import 鏈不 throw。
vi.mock("@/lib/env.server", () => ({ serverEnv: {} }))

const revalidatePath = vi.fn()
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}))

const requireAdmin = vi
  .fn()
  .mockResolvedValue({ id: "admin-1", email: "admin@example.com" })
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
}))

// 記錄「呼叫順序」——T77 的不變式就是「transition 先、update tracking 後」。
const callOrder: string[] = []

const state = {
  transitionThrow: null as Error | null,
  trackingUpdateError: null as { message: string } | null,
  sendOnceResult: true,
}

const transitionOrder = vi.fn(async () => {
  callOrder.push("transition")
  if (state.transitionThrow) throw state.transitionThrow
})
// class 定義放進工廠內（避免 vi.mock 提升造成的 TDZ）；測試再從 mocked 模組
// import OrderTransitionRaceError 來建構，與 actions.ts 內的 instanceof 同一個類別。
vi.mock("@/lib/order/state-machine", () => {
  class OrderTransitionRaceError extends Error {}
  class PaidOrderCancelBlockedError extends Error {}
  return {
    transitionOrder: () => transitionOrder(),
    adminOverrideStatus: vi.fn(),
    OrderTransitionRaceError,
    PaidOrderCancelBlockedError,
  }
})

// orders.update(tracking_no).eq("id", …) 記錄一次寫入；回傳 { error } 依 state。
const trackingUpdates: any[] = []
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      update: (values: any) => ({
        eq: () => {
          callOrder.push("update-tracking")
          trackingUpdates.push({ table, values })
          return Promise.resolve({ error: state.trackingUpdateError })
        },
      }),
    }),
  }),
}))

const sendOnce = vi.fn(async () => {
  callOrder.push("sendOnce")
  return state.sendOnceResult
})
vi.mock("@/lib/notification/send-once", () => ({
  sendOnce: () => sendOnce(),
}))

vi.mock("@/lib/email/order-shipped-notification", () => ({
  sendOrderShippedNotification: vi.fn(async () => {}),
}))

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))

import { shipOrder } from "../actions"
import { OrderTransitionRaceError } from "@/lib/order/state-machine"

beforeEach(() => {
  callOrder.length = 0
  trackingUpdates.length = 0
  state.transitionThrow = null
  state.trackingUpdateError = null
  state.sendOnceResult = true
  transitionOrder.mockClear()
  sendOnce.mockClear()
})

describe("shipOrder 先驗狀態轉換再寫 tracking_no（T77）", () => {
  it("非法轉換（transitionOrder 拋錯）→ 回失敗，且絕不寫入 tracking_no", async () => {
    state.transitionThrow = new Error("illegal transition")

    const result = await shipOrder("order-1", "JT1234567890", "delivery")

    expect(result.ok).toBe(false)
    // 核心不變式：轉換失敗時 orders.update(tracking_no) 完全沒被呼叫
    expect(trackingUpdates).toHaveLength(0)
    expect(callOrder).toEqual(["transition"])
    expect(sendOnce).not.toHaveBeenCalled()
  })

  it("競態（OrderTransitionRaceError）→ 回競態訊息，同樣不寫 tracking_no", async () => {
    state.transitionThrow = new OrderTransitionRaceError("race")

    const result = await shipOrder("order-1", "JT1234567890", "delivery")

    expect(result.ok).toBe(false)
    expect(trackingUpdates).toHaveLength(0)
  })

  it("合法路徑 → 先 transition、後寫 tracking_no、再 sendOnce，回 ok", async () => {
    const result = await shipOrder("order-1", "JT1234567890", "delivery")

    expect(result).toEqual({ ok: true })
    expect(trackingUpdates).toEqual([
      {
        table: "orders",
        values: { tracking_no: "JT1234567890", delivery_method: "delivery" },
      },
    ])
    // 順序正確：轉換在寫單號之前
    expect(callOrder).toEqual(["transition", "update-tracking", "sendOnce"])
  })

  it("tracking_no 寫入失敗 → 訂單已 shipped，回 warning（非 error）、不寄通知", async () => {
    state.trackingUpdateError = { message: "connection reset" }

    const result = await shipOrder("order-1", "JT1234567890", "delivery")

    expect(result.ok).toBe(true)
    expect((result as { warning?: string }).warning).toMatch(/物流單號寫入失敗/)
    // 轉換已成功、單號寫入失敗 → 不寄含單號的通知信
    expect(sendOnce).not.toHaveBeenCalled()
    expect(callOrder).toEqual(["transition", "update-tracking"])
  })
})
