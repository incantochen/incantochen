import { describe, it, expect } from "vitest"
import {
  PICKUP_PREFIX,
  buildPickupTracking,
  parseTracking,
} from "@/lib/order/shipping-tracking"

describe("shipping-tracking 單一出處", () => {
  it("面交無備註：只存前綴", () => {
    expect(buildPickupTracking()).toBe(PICKUP_PREFIX)
    expect(buildPickupTracking("")).toBe(PICKUP_PREFIX)
    expect(buildPickupTracking("   ")).toBe(PICKUP_PREFIX)
  })

  it("面交含備註：前綴＋空格＋trim 後備註", () => {
    expect(buildPickupTracking("2026-07-05 台北")).toBe("面交 2026-07-05 台北")
    expect(buildPickupTracking("  週六下午  ")).toBe("面交 週六下午")
  })

  // 寫入端 buildPickupTracking → 解析端 parseTracking 必須還原，兩端同步的鎖
  it("round-trip：build 出的字串 parse 回原備註（面交）", () => {
    for (const note of ["", "2026-07-05", "門市自取 週六"]) {
      const parsed = parseTracking(buildPickupTracking(note))
      expect(parsed.isPickup).toBe(true)
      expect(parsed.pickupNote).toBe(note.trim())
    }
  })

  it("宅配單號：非面交，pickupNote 為空、單號原樣（trim）", () => {
    const parsed = parseTracking("  1234567890  ")
    expect(parsed.isPickup).toBe(false)
    expect(parsed.pickupNote).toBe("")
  })
})
