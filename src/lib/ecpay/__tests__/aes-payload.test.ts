import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  aesUrlEncode,
  encryptEcpayPayload,
  decryptEcpayPayload,
} from "../aes-payload";

// 測試向量來源：.claude/skills/ecpay/test-vectors/aes-encryption.json
// （綠界官方發布的 AES-128-CBC 測試向量，非本專案自造）
const HASH_KEY = "ejCk326UnaZWKisg";
const HASH_IV = "q9jcZX8Ib9LM8wYk";

describe("aesUrlEncode", () => {
  it("空格編碼為 +，非 %20", () => {
    expect(aesUrlEncode("a b")).toBe("a+b");
  });

  it("~ 編碼為 %7E（encodeURIComponent 預設不編碼 ~）", () => {
    expect(aesUrlEncode("~")).toBe("%7E");
  });

  it("特殊字元測試向量：{\"Name\":\"test!*'()~value\"} 的密文與官方 base64 一致", () => {
    // 官方 Vector 3（特殊字元）：一次驗證 !*'()~ 的編碼路徑到最終密文
    const result = encryptEcpayPayload(
      { Name: "test!*'()~value" },
      HASH_KEY,
      HASH_IV,
    );
    expect(result).toBe(
      "uvI4yrErM37XNQkXGAgRgBuDOiJoVs72Xn/rum9Ejl1DSna4HyLSoY7764PmhTR7JXb9jJWLSjCGcZEDeFiABg==",
    );
  });
});

describe("encryptEcpayPayload — 官方測試向量", () => {
  it("Vector 1：基本測試（插入順序 JSON key）", () => {
    const data = { MerchantID: "2000132", BarCode: "/1234567" };
    const result = encryptEcpayPayload(data, HASH_KEY, HASH_IV);
    expect(result).toBe(
      "XeEOdHpTRvxKEqs/JD9RSd16s7VtpyWVCN6AV44pKTW3DVa6yI7vKmjBRp2eulDhXoru/qBqFDBH3fEqlkMn3bbJfJBfGAq+v+SvttutYnc=",
    );
  });

  it("Vector：UTF-8 中文字元測試", () => {
    const data = { MerchantID: "2000132", ItemName: "綠界科技測試商品" };
    const result = encryptEcpayPayload(data, HASH_KEY, HASH_IV);
    expect(result).toBe(
      "XeEOdHpTRvxKEqs/JD9RSd16s7VtpyWVCN6AV44pKTVKsXddZRgV+Cle9oeB2PqsEC2O0oDi4kObiCtdGznG9aAX69Kj0//VjGXhieBYZ3RuGW9v20xQyBevaBwtOvg1lYjlDw6jsgfToGMUvlGsIJ2DO6/tbXjNZumnRgj2GCSj7LLDRBU3KlkUWji16nO1",
    );
  });

  it("Vector：PKCS7 16-byte 邊界測試（url-encode 後剛好 32 bytes）", () => {
    const data = { N: "1234567890" };
    const result = encryptEcpayPayload(data, HASH_KEY, HASH_IV);
    expect(result).toBe(
      "gVwWJnIpl1m3ZDypcRAjiCctilYnQhHn4h8OzJP5IxQPov7HuysXX+jPONvrHS7Z",
    );
  });

  it("ECPG 帳號測試向量（驗證帳號切換不影響加密邏輯）", () => {
    const data = { MerchantID: "3002607", RespondType: "JSON" };
    const result = encryptEcpayPayload(
      data,
      "pwFHCqoQZGmho4w6",
      "EkRm7iFT261dpevs",
    );
    expect(result).toBe(
      "udqjXgM+7Q6lCrrculcvzUFnN5zv0ibax1glKFxrORoO0sl6pcoib/QDYPKCAP57ME4+3Yo84XmyabVFnxriMTuy9JK/RXS7DtEOvF+PUoU=",
    );
  });
});

describe("decryptEcpayPayload — 官方測試向量（反向驗證）", () => {
  it("Vector 1 的加密結果可正確解密回原始 JSON", () => {
    const encrypted =
      "XeEOdHpTRvxKEqs/JD9RSd16s7VtpyWVCN6AV44pKTW3DVa6yI7vKmjBRp2eulDhXoru/qBqFDBH3fEqlkMn3bbJfJBfGAq+v+SvttutYnc=";
    const result = decryptEcpayPayload(encrypted, HASH_KEY, HASH_IV);
    expect(result).toEqual({ MerchantID: "2000132", BarCode: "/1234567" });
  });
});

describe("encryptEcpayPayload / decryptEcpayPayload — round-trip", () => {
  it("任意物件加密後可解密還原（含特殊字元、巢狀陣列）", () => {
    const data = {
      RelateNumber: "INC20260714ABCDE12",
      Items: [
        { ItemName: "祖母綠戒指 (18K) — 100% 保固!", ItemAmount: 25000 },
      ],
      Note: "含 & < > ' \" ~ 符號",
    };
    const encrypted = encryptEcpayPayload(data, HASH_KEY, HASH_IV);
    const decrypted = decryptEcpayPayload(encrypted, HASH_KEY, HASH_IV);
    expect(decrypted).toEqual(data);
  });

  it("Base64 輸出使用標準 alphabet（含 +/=，不含 URL-safe 的 -_）", () => {
    // Vector 1 的輸出本身就含 + 與 =，驗證我們沒有誤用 base64url
    const data = { MerchantID: "2000132", BarCode: "/1234567" };
    const result = encryptEcpayPayload(data, HASH_KEY, HASH_IV);
    expect(result).toMatch(/[+/=]/);
    expect(result).not.toMatch(/[-_]/);
  });
});
