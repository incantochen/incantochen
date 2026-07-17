import { describe, it, expect } from "vitest";
import { validateSettleAmount } from "../validate-settle-amount";

describe("validateSettleAmount", () => {
  it("金額相符（正數）→ ok", () => {
    expect(validateSettleAmount(25000, 25000)).toEqual({ ok: true });
  });

  it("numeric 欄位序列化成字串仍正確比對（Number 轉型）", () => {
    expect(validateSettleAmount(25000, "25000")).toEqual({ ok: true });
  });

  it("NaN（TradeAmt 格式異常）→ non-finite", () => {
    expect(validateSettleAmount(NaN, 25000)).toEqual({
      ok: false,
      reason: "non-finite",
    });
  });

  it("0 === 0 不得視為吻合 → non-positive", () => {
    expect(validateSettleAmount(0, 0)).toEqual({
      ok: false,
      reason: "non-positive",
    });
  });

  it("負數 → non-positive", () => {
    expect(validateSettleAmount(-100, -100)).toEqual({
      ok: false,
      reason: "non-positive",
    });
  });

  it("正數但金額不符 → mismatch", () => {
    expect(validateSettleAmount(9999, 25000)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });
});
