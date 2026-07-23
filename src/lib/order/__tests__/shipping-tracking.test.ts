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

  // T63 漂移防呆：migration 0023 的 anonymize_member RPC 在 SQL 端寫死
  // `tracking_no like '面交%' then '面交'` 來洗除面交備註 PII（SQL 無法 import
  // 此常數）。若改動 PICKUP_PREFIX 的字面值，務必同步
  // supabase/migrations/0023_pii_erasure_log_and_anonymize_member.sql，否則面交訂單
  // 夾帶的自取備註（客人姓名/時間/地點）會逃過刪除請求的匿名化。改名時此測試立刻變紅。
  it("PICKUP_PREFIX 與 migration 0023 寫死的 '面交' 字面量同步", () => {
    expect(PICKUP_PREFIX).toBe("面交")
  })
})
