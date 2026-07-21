import { describe, expect, it } from "vitest";
import { computeStartPrice } from "../start-price";

describe("computeStartPrice", () => {
  it("底價＋各選項預設值加價總和", () => {
    expect(
      computeStartPrice(25000, [
        {
          product_option_value: [
            { is_default: false, price_delta: 999 },
            { is_default: true, price_delta: 2000 },
          ],
        },
        {
          product_option_value: [{ is_default: true, price_delta: 500 }],
        },
      ]),
    ).toBe(27500);
  });

  it("無預設值時 fallback 該組第一個值（比照目錄卡既有行為）", () => {
    expect(
      computeStartPrice(10000, [
        {
          product_option_value: [
            { is_default: false, price_delta: 300 },
            { is_default: false, price_delta: 700 },
          ],
        },
      ]),
    ).toBe(10300);
  });

  it("選項組無值時視為 0 加價，不 NaN", () => {
    expect(computeStartPrice(10000, [{ product_option_value: [] }])).toBe(
      10000,
    );
  });

  it("無任何選項組時＝底價", () => {
    expect(computeStartPrice(8000, [])).toBe(8000);
  });

  it("numeric 欄位回字串時仍正確相加（§6 PostgREST numeric）", () => {
    expect(
      computeStartPrice("25000", [
        {
          product_option_value: [
            // 生成型別標 number、runtime 可能是字串——刻意繞過型別餵字串
            { is_default: true, price_delta: "2000" as unknown as number },
          ],
        },
      ]),
    ).toBe(27000);
  });
});
