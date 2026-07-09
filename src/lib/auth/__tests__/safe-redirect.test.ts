import { describe, it, expect } from "vitest";
import { safeRedirect } from "../safe-redirect";

describe("safeRedirect", () => {
  it("returns / for null", () => {
    expect(safeRedirect(null)).toBe("/");
  });

  it("returns / for empty string", () => {
    expect(safeRedirect("")).toBe("/");
  });

  it("passes through a normal relative path", () => {
    expect(safeRedirect("/account")).toBe("/account");
  });

  it("passes through a path with segments", () => {
    expect(safeRedirect("/orders/123")).toBe("/orders/123");
  });

  it("passes through a root path with a query string", () => {
    expect(safeRedirect("/?next=/abc")).toBe("/?next=/abc");
  });

  it("rejects absolute URLs not starting with /", () => {
    expect(safeRedirect("https://evil.com")).toBe("/");
    expect(safeRedirect("evil.com")).toBe("/");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirect("//evil.com")).toBe("/");
  });

  it("rejects backslash-prefixed paths", () => {
    expect(safeRedirect("/\\evil.com")).toBe("/");
  });

  it("rejects a tab-hidden protocol-relative URL", () => {
    expect(safeRedirect("/\t/evil.com")).toBe("/");
  });

  it("rejects a newline-hidden protocol-relative URL", () => {
    expect(safeRedirect("/\n/evil.com")).toBe("/");
    expect(safeRedirect("/\r/evil.com")).toBe("/");
  });

  it("strips harmless embedded control characters from an otherwise safe path", () => {
    expect(safeRedirect("/acc\tount")).toBe("/account");
  });
});
