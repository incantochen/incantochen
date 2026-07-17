import { vi, describe, it, expect } from "vitest";

vi.mock("server-only", () => ({}));

import { getClientIp } from "@/lib/get-client-ip";
import type { headers } from "next/headers";

function fakeHeaders(
  entries: Record<string, string>,
): Awaited<ReturnType<typeof headers>> {
  const map = new Map(
    Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    get: (name: string) => map.get(name.toLowerCase()) ?? null,
  } as Awaited<ReturnType<typeof headers>>;
}

describe("getClientIp（T121）", () => {
  it("x-vercel-forwarded-for 優先於 x-forwarded-for", () => {
    expect(
      getClientIp(
        fakeHeaders({
          "x-vercel-forwarded-for": "203.0.113.7",
          "x-forwarded-for": "198.51.100.9",
        }),
      ),
    ).toBe("203.0.113.7");
  });

  it("多值時取最左值並 trim", () => {
    expect(
      getClientIp(
        fakeHeaders({ "x-vercel-forwarded-for": " 203.0.113.7 , 10.0.0.1" }),
      ),
    ).toBe("203.0.113.7");
    expect(
      getClientIp(
        fakeHeaders({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" }),
      ),
    ).toBe("198.51.100.9");
  });

  it("cf-connecting-ip／x-real-ip 不再被信任（客戶端可自帶輪換，會架空 IP 限流）", () => {
    expect(
      getClientIp(
        fakeHeaders({
          "cf-connecting-ip": "6.6.6.6",
          "x-real-ip": "6.6.6.7",
          "x-forwarded-for": "198.51.100.9",
        }),
      ),
    ).toBe("198.51.100.9");
    expect(
      getClientIp(
        fakeHeaders({ "cf-connecting-ip": "6.6.6.6", "x-real-ip": "6.6.6.7" }),
      ),
    ).toBeNull();
  });

  it("header 全缺或值為空字串 → null（呼叫端據此跳過 IP 限流，避免共用 bucket 誤鎖）", () => {
    expect(getClientIp(fakeHeaders({}))).toBeNull();
    expect(getClientIp(fakeHeaders({ "x-forwarded-for": "" }))).toBeNull();
    expect(getClientIp(fakeHeaders({ "x-forwarded-for": " , 10.0.0.1" }))).toBeNull();
  });
});
