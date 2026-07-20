/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect } from "vitest";

vi.mock("server-only", () => ({}));

import { isProductUnavailable } from "../check-product-availability";

// service role 的 .from("product_option").select(...).eq(...).eq(...) 是個
// thenable：鏈到底 resolve {data,error}。用 result 注入每個測試的回傳。
function makeServiceRole(result: { data: any; error: any }) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return { from: () => chain } as any;
}

const activeType = { is_active: true };
const inactiveType = { is_active: false };
const activeValue = { option_value: { is_active: true } };
const inactiveValue = { option_value: { is_active: false } };

describe("isProductUnavailable（T117）", () => {
  it("所有必選選項的類別與值都顯示中 → 可販售（false）", async () => {
    const sr = makeServiceRole({
      data: [
        { id: "po1", option_type: activeType, product_option_value: [activeValue] },
        {
          id: "po2",
          option_type: activeType,
          product_option_value: [inactiveValue, activeValue],
        },
      ],
      error: null,
    });
    expect(await isProductUnavailable(sr, "prod-1")).toBe(false);
  });

  it("某必選選項的類別已隱藏 → 暫停販售（true）", async () => {
    const sr = makeServiceRole({
      data: [
        { id: "po1", option_type: activeType, product_option_value: [activeValue] },
        { id: "po2", option_type: inactiveType, product_option_value: [activeValue] },
      ],
      error: null,
    });
    expect(await isProductUnavailable(sr, "prod-1")).toBe(true);
  });

  it("某必選選項的值全數隱藏 → 暫停販售（true）", async () => {
    const sr = makeServiceRole({
      data: [
        {
          id: "po1",
          option_type: activeType,
          product_option_value: [inactiveValue, inactiveValue],
        },
      ],
      error: null,
    });
    expect(await isProductUnavailable(sr, "prod-1")).toBe(true);
  });

  it("必選選項底下完全沒有值 → 暫停販售（true）", async () => {
    const sr = makeServiceRole({
      data: [{ id: "po1", option_type: activeType, product_option_value: [] }],
      error: null,
    });
    expect(await isProductUnavailable(sr, "prod-1")).toBe(true);
  });

  it("商品沒有任何必選選項 → 可販售（false）", async () => {
    const sr = makeServiceRole({ data: [], error: null });
    expect(await isProductUnavailable(sr, "prod-1")).toBe(false);
  });

  it("查詢失敗 → fail-open 視為可販售（false），不誤標暫停販售", async () => {
    const sr = makeServiceRole({ data: null, error: { message: "db down" } });
    expect(await isProductUnavailable(sr, "prod-1")).toBe(false);
  });
});
