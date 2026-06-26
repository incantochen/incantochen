import "server-only"
import { createHash, timingSafeEqual } from "crypto"

// ECPay 要求的編碼規則和標準 encodeURIComponent / .NET UrlEncode 有差異，
// 須在 encodeURIComponent 之後手動還原這些字元才會跟綠界端算出同一個雜湊。
function ecpayUrlEncode(source: string): string {
  return encodeURIComponent(source)
    .toLowerCase()
    .replace(/%2d/g, "-")
    .replace(/%5f/g, "_")
    .replace(/%2e/g, ".")
    .replace(/%21/g, "!")
    .replace(/%2a/g, "*")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%20/g, "+")
}

function buildHashSource(
  params: Record<string, string>,
  hashKey: string,
  hashIv: string,
): string {
  const sortedEntries = Object.entries(params)
    .filter(([key]) => key !== "CheckMacValue")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const query = sortedEntries.map(([key, value]) => `${key}=${value}`).join("&")
  const raw = `HashKey=${hashKey}&${query}&HashIV=${hashIv}`
  return ecpayUrlEncode(raw)
}

export function generateCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIv: string,
): string {
  const encoded = buildHashSource(params, hashKey, hashIv)
  return createHash("sha256").update(encoded).digest("hex").toUpperCase()
}

export function verifyCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIv: string,
): boolean {
  const received = params.CheckMacValue
  if (!received) return false

  const expected = generateCheckMacValue(params, hashKey, hashIv)
  const a = Buffer.from(expected.toUpperCase())
  const b = Buffer.from(received.toUpperCase())
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
