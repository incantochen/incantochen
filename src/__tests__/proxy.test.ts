/* eslint-disable @typescript-eslint/no-explicit-any */
// T133：proxy 首載預簽 guest_token。核心風險不是「有沒有設 cookie」，而是
// 「setAll（session 刷新）重建 response 後 guest cookie 是否還在最終 response
// 上」——故第③例走完整 middleware chain（getUser→setAll fire→response 重建），
// 斷言 auth cookie 與 guest cookie 兩者共存，釘住「guest cookie 設在最終
// response、比照 CSP 位置」的設計，防日後有人把 set 提前到重建前而靜默退化。
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://dummy.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy",
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));

// createServerClient 的 getUser 行為由每個測試設定；setAll 是否 fire 決定
// response 會不會被重建。用一個可注入的 behaviour 物件控制。
const behaviour = {
  // 呼叫 getUser 時要不要透過 setAll 寫一顆刷新後的 auth cookie（模擬 session
  // 刷新），以及 getUser 要不要 throw。
  refreshAuthCookie: false,
  throwOnGetUser: false,
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opts: any) => ({
    auth: {
      getUser: async () => {
        if (behaviour.refreshAuthCookie) {
          // 真實 supabase/ssr 刷新 session 時就是透過 cookies.setAll 回寫——
          // 這會觸發 proxy 內以 request 為基底重建 response。
          opts.cookies.setAll([
            {
              name: "sb-auth-token",
              value: "refreshed",
              options: { path: "/", httpOnly: true },
            },
          ]);
        }
        if (behaviour.throwOnGetUser) {
          throw new Error("supabase down");
        }
        return { data: { user: null }, error: null };
      },
    },
  }),
}));

async function importProxy() {
  const mod = await import("@/proxy");
  return mod.proxy;
}

function makeRequest(cookieHeader?: string) {
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  return new NextRequest("https://shop.example/products/ring", { headers });
}

function guestSetCookie(res: any): string | undefined {
  // NextResponse.cookies.getAll() 回結構化 cookie；找 guest_token。
  const c = res.cookies.get("guest_token");
  return c?.value;
}

describe("proxy guest_token pre-sign (T133)", () => {
  beforeEach(() => {
    behaviour.refreshAuthCookie = false;
    behaviour.throwOnGetUser = false;
    vi.resetModules();
  });

  it("① 無 cookie → 最終 response 帶 Set-Cookie（屬性齊）＋CSP 仍在", async () => {
    const proxy = await importProxy();
    const res = await proxy(makeRequest());

    const cookie = res.cookies.get("guest_token");
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 30);
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("② 已有 cookie → 不 roll（不重簽）", async () => {
    const proxy = await importProxy();
    const res = await proxy(makeRequest("guest_token=existing-tok"));

    // 未首簽時 proxy 不呼叫 response.cookies.set(guest_token) → 沒有對應 Set-Cookie。
    expect(res.cookies.get("guest_token")).toBeUndefined();
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("③ middleware chain：session 刷新重建 response 後，auth cookie 與 guest cookie 兩者都在＋CSP 在", async () => {
    behaviour.refreshAuthCookie = true; // setAll fire → response 被重建
    const proxy = await importProxy();
    const res = await proxy(makeRequest());

    // 重建後仍要同時保有：刷新的 auth cookie（證明 setAll 生效）＋預簽 guest
    // cookie（證明 guest set 在最終 response 上、沒被重建吞掉）。
    expect(res.cookies.get("sb-auth-token")?.value).toBe("refreshed");
    expect(guestSetCookie(res)).toBeTruthy();
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("④ getUser throw（fail-soft）→ guest cookie 與 CSP 仍在最終 response", async () => {
    behaviour.throwOnGetUser = true;
    const proxy = await importProxy();
    const res = await proxy(makeRequest());

    expect(guestSetCookie(res)).toBeTruthy();
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });
});
