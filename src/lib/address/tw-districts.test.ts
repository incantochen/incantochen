import { describe, it, expect } from "vitest";
import { twCities, districtsOf, zipOf } from "./tw-districts";

describe("tw-districts 資料集", () => {
  it("涵蓋 22 縣市、371 區", () => {
    expect(twCities).toHaveLength(22);
    const total = twCities.reduce((n, c) => n + c.districts.length, 0);
    expect(total).toBe(371);
  });

  it("每個郵遞區號為 3 碼數字、每個區有名稱", () => {
    for (const city of twCities) {
      expect(city.name.length).toBeGreaterThan(0);
      for (const d of city.districts) {
        expect(d.name.length).toBeGreaterThan(0);
        expect(d.zip).toMatch(/^\d{3}$/);
      }
    }
  });

  it("縣市名採標準字（臺北市而非台北市）", () => {
    expect(twCities.some((c) => c.name === "臺北市")).toBe(true);
    expect(twCities.some((c) => c.name === "台北市")).toBe(false);
  });
});

describe("districtsOf", () => {
  it("回傳指定縣市的區清單", () => {
    const list = districtsOf("臺北市");
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((d) => d.name === "大安區")).toBe(true);
  });

  it("查無縣市回空陣列", () => {
    expect(districtsOf("火星市")).toEqual([]);
  });
});

describe("zipOf", () => {
  it("縣市＋區帶出正確 3 碼郵遞區號", () => {
    expect(zipOf("臺北市", "大安區")).toBe("106");
    expect(zipOf("臺北市", "中正區")).toBe("100");
  });

  it("查無縣市或區回空字串", () => {
    expect(zipOf("臺北市", "不存在區")).toBe("");
    expect(zipOf("火星市", "大安區")).toBe("");
  });
});
