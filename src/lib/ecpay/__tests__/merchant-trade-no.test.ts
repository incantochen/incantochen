import { vi, describe, it, expect } from "vitest"

// merchant-trade-no.ts／aio-payment.ts 皆 import "server-only"（node 測試環境會
// throw client-component 錯誤）——比照 notify route.test.ts 以空模組 mock 掉。
vi.mock("server-only", () => ({}))

// aio-payment.ts 頂層 import serverEnv（env.server 載入即 fail-fast 驗證必填變數）；
// buildItemName 不使用 serverEnv，給空物件讓 import 不 throw 即可。
vi.mock("@/lib/env.server", () => ({ serverEnv: {} }))

import {
  generateMerchantTradeNo,
  merchantTradeNoToOrderNo,
} from "@/lib/ecpay/merchant-trade-no"
import { buildItemName } from "@/lib/ecpay/aio-payment"

describe("merchant-trade-no 單一出處（F-009 / T96）", () => {
  it("generate：order_no 去 hyphen + 2 碼後綴 = 19 碼", () => {
    const mtno = generateMerchantTradeNo("INC-20260720-ABCDEF")
    expect(mtno).toHaveLength(19)
    expect(mtno.slice(0, 17)).toBe("INC20260720ABCDEF")
  })

  // 寫入端 generate → 解析端 parse 必須還原（T67 slice(11) bug 的回歸鎖）
  it("round-trip：generate 出的 trade no parse 回原 order_no", () => {
    for (const orderNo of [
      "INC-20260720-ABCDEF",
      "INC-20991231-Z2Z2Z2",
      "INC-20260101-234567",
    ]) {
      expect(merchantTradeNoToOrderNo(generateMerchantTradeNo(orderNo))).toBe(
        orderNo,
      )
    }
  })

  it("parse：直接給 19 碼 trade no，重組出 INC-YYYYMMDD-XXXXXX", () => {
    expect(merchantTradeNoToOrderNo("INC20260720ABCDEFXY")).toBe(
      "INC-20260720-ABCDEF",
    )
  })

  it("parse：剛好 17 碼本體（無後綴）也能還原", () => {
    expect(merchantTradeNoToOrderNo("INC20260720ABCDEF")).toBe(
      "INC-20260720-ABCDEF",
    )
  })

  it("防呆：本體長度不足 17 回 null（不硬塞殘缺 order_no）", () => {
    expect(merchantTradeNoToOrderNo("INC2026")).toBeNull()
    expect(merchantTradeNoToOrderNo("")).toBeNull()
  })
})

describe("buildItemName # sanitize（T96 隨手）", () => {
  it("商品名含 # 換成全形 ＃，避免被當品項分隔符切開", () => {
    expect(buildItemName([{ productName: "戒指 #1 款", quantity: 2 }])).toBe(
      "戒指 ＃1 款 x2",
    )
  })

  it("多品項仍以半形 # 分隔", () => {
    expect(
      buildItemName([
        { productName: "A", quantity: 1 },
        { productName: "B", quantity: 3 },
      ]),
    ).toBe("A x1#B x3")
  })
})
