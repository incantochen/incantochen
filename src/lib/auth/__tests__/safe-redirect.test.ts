import { describe, it, expect } from "vitest";

import { safeRedirect } from "../safe-redirect";

describe("safeRedirect", () => {
  it("null 或空字串 → 首頁", () => {
    expect(safeRedirect(null)).toBe("/");
    expect(safeRedirect("")).toBe("/");
  });

  it("正常站內相對路徑 → 原樣通過", () => {
    expect(safeRedirect("/account")).toBe("/account");
    expect(safeRedirect("/checkout/pay")).toBe("/checkout/pay");
  });

  it("非 / 開頭的絕對網址 → 首頁", () => {
    expect(safeRedirect("https://evil.com")).toBe("/");
    expect(safeRedirect("evil.com")).toBe("/");
  });

  it("protocol-relative URL（//evil.com）→ 首頁", () => {
    expect(safeRedirect("//evil.com")).toBe("/");
  });

  it("反斜線變形（/\\evil.com）→ 首頁", () => {
    expect(safeRedirect("/\\evil.com")).toBe("/");
  });
});
