import "server-only";
import { createCipheriv, createDecipheriv } from "crypto";

// ECPay AES-JSON 協議（發票／站內付 2.0／幕後授權等，非本檔涵蓋範圍）共用的
// 加解密層。與同目錄 check-mac-value.ts 的 CMV-SHA256 是完全不同的兩套協議，
// 兩者的 URL encode 規則不同（見下方 aesUrlEncode 註解），禁止共用函式——
// 混用會讓 ECPay 端解密/驗章永遠失敗。

// AES 版 URL encode：對齊 .NET HttpUtility.UrlEncode（官方測試向量的基準）——
// 空格→+，且 encodeURIComponent 放行的 !*'()~ 也要補編碼（官方特殊字元向量
// 明訂 !→%21、*→%2A、'→%27、(→%28、)→%29、~→%7E）。不轉小寫、不做 CMV
// 那套 .NET 字元還原——這是與 ecpayUrlEncode（check-mac-value.ts）的關鍵
// 差異，混用任一方向都會讓 ECPay 解密出的 JSON 對不上原文。
export function aesUrlEncode(source: string): string {
  return encodeURIComponent(source)
    .replace(/%20/g, "+")
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/~/g, "%7E");
}

// ECPay AES-JSON 固定用 AES-128-CBC，key/iv 各取 HashKey/HashIV 前 16 bytes
// （官方規格：HashKey 當 key、HashIV 當 iv，皆為 16 字元 ASCII）。
const ALGORITHM = "aes-128-cbc";

// 加密：compact JSON（不 HTML-escape <>&，JSON.stringify 預設行為即符合）
// → aesUrlEncode → AES-128-CBC（Node 預設 PKCS7 padding）→ 標準 Base64（+/=，
// 非 URL-safe）。回傳值直接放進外層 Data 欄位。
export function encryptEcpayPayload(
  data: unknown,
  hashKey: string,
  hashIv: string,
): string {
  const compactJson = JSON.stringify(data);
  const encoded = aesUrlEncode(compactJson);
  const cipher = createCipheriv(ALGORITHM, hashKey, hashIv);
  const encrypted = Buffer.concat([
    cipher.update(encoded, "utf8"),
    cipher.final(),
  ]);
  return encrypted.toString("base64"); // 標準 alphabet，Buffer 預設即是
}

// 解密：反向 → JSON.parse。回傳 unknown，呼叫端自行用 zod 驗證形狀
// （回應結構隨 API 而異，不在此假設）。
export function decryptEcpayPayload(
  base64Data: string,
  hashKey: string,
  hashIv: string,
): unknown {
  const decipher = createDecipheriv(ALGORITHM, hashKey, hashIv);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(base64Data, "base64")),
    decipher.final(),
  ]);
  // decodeURIComponent 不會把 "+" 還原成空格（那是 www-form-urlencoded 解析器
  // 才有的行為，不是標準 URI 解碼）——aesUrlEncode 把空格編成 "+"，這裡不先轉
  // 回空格會讓所有含空格的欄位解密後多出字面上的 "+"，round-trip 失敗。
  const withSpaces = decrypted.toString("utf8").replace(/\+/g, " ");
  const decoded = decodeURIComponent(withSpaces);
  return JSON.parse(decoded);
}

// RqHeader.Timestamp：Unix **秒**（非毫秒），10 分鐘時效——呼叫端組請求時
// 用這支，避免各處各自 Date.now()/1000 手刻、忘記取整或除以 1000
export function ecpayTimestampSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
