import { describe, it, expect } from "vitest";
import { escapeHtml } from "./escape-html";

describe("escapeHtml", () => {
  it("跳脫 HTML 特殊字元，防止插入信件 HTML 時被解讀成標籤／屬性", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
  });

  it("跳脫單引號，防止逃出以單引號包住的 HTML 屬性", () => {
    expect(escapeHtml("<img src=x onerror='alert(1)'>")).toBe(
      "&lt;img src=x onerror=&#39;alert(1)&#39;&gt;",
    );
  });

  it("& 必須先跳脫，避免把其他字元的跳脫序列二次跳脫成 &amp;lt; 之類的錯誤輸出", () => {
    expect(escapeHtml("Tom & Jerry <3")).toBe("Tom &amp; Jerry &lt;3");
  });

  it("純文字不受影響", () => {
    expect(escapeHtml("王小明")).toBe("王小明");
  });
});
