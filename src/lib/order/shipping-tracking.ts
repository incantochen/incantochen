// 面交（自取）與宅配共用 orders.tracking_no 一個字串欄位，靠 PICKUP_PREFIX
// 前綴分流（MVP 未另立配送方式欄位，留 T48 物流定案時處理）。寫入端
// （admin order-actions 的 handleShip）與解析端（order-shipped-notification）
// 必須用同一份格式定義，否則任一端改寫法（如改詞「自取」或「面交：日期」）
// 即靜默失準：面交單被判宅配、客人收到「已交由物流出貨請留意簽收」的矛盾通知。
// 此模組為該格式的單一出處，禁止各處手刻字面量（CLAUDE.md §6 識別碼格式互轉
// 單一出處；F-015，與 T67 slice 複本失同步同型）。

export const PICKUP_PREFIX = "面交"

/**
 * 面交出貨：把選填備註組成 tracking_no 字串。
 * 宅配走真實物流單號、不經此函式（tracking_no 直接存單號）。
 */
export function buildPickupTracking(note?: string): string {
  const trimmed = note?.trim() ?? ""
  return trimmed ? `${PICKUP_PREFIX} ${trimmed}` : PICKUP_PREFIX
}

/**
 * 解析 tracking_no：
 * - 面交 → { isPickup: true, pickupNote }（去前綴後 trim 的備註，可能為空字串）
 * - 宅配 → { isPickup: false, pickupNote: "" }（trackingNo 即物流單號本身）
 */
export function parseTracking(trackingNo: string): {
  isPickup: boolean
  pickupNote: string
} {
  const trimmed = trackingNo.trim()
  const isPickup = trimmed.startsWith(PICKUP_PREFIX)
  return {
    isPickup,
    pickupNote: isPickup ? trimmed.slice(PICKUP_PREFIX.length).trim() : "",
  }
}
