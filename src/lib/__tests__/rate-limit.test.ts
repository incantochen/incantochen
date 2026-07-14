import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// env.server 會在 import 時 eager 驗證所有必填變數，測試給固定假值即可。
vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    UPSTASH_REDIS_REST_URL: "http://localhost",
    UPSTASH_REDIS_REST_TOKEN: "test-token",
  },
}));

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

// Redis 建構子在 module load 時被呼叫；給個空殼避免真的連線。
vi.mock("@upstash/redis", () => ({
  Redis: class {},
}));

// 每個 Ratelimit instance 的 limit() 行為由 limitImpl 控制，測試逐案覆寫。
let limitImpl: (id: string) => Promise<{ success: boolean }>;
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    limit(id: string) {
      return limitImpl(id);
    }
  },
}));

import {
  checkOrderPageViewRateLimit,
  checkOrderPayCreateRateLimit,
} from "@/lib/rate-limit";

describe("order rate-limit helpers", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it("回 true 當所有維度都在額度內", async () => {
    limitImpl = async () => ({ success: true });
    expect(await checkOrderPageViewRateLimit("1.2.3.4", "INC-1")).toBe(true);
    expect(await checkOrderPayCreateRateLimit("1.2.3.4", "INC-1")).toBe(true);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("回 false 當任一維度超額", async () => {
    limitImpl = async (id) => ({ success: id !== "INC-1" });
    // order_no 維度（identifier = "INC-1"）超額 → 整體擋下
    expect(await checkOrderPageViewRateLimit("1.2.3.4", "INC-1")).toBe(false);
  });

  it("#1 fail-open：Redis 例外時放行並記 Sentry，不讓限流故障擋掉付款頁", async () => {
    limitImpl = async () => {
      throw new Error("Upstash unreachable");
    };
    expect(await checkOrderPageViewRateLimit("1.2.3.4", "INC-1")).toBe(true);
    expect(await checkOrderPayCreateRateLimit("1.2.3.4", "INC-1")).toBe(true);
    expect(captureException).toHaveBeenCalled();
  });

  it("ip 為 null 時跳過 IP 維度、只查 order_no 維度", async () => {
    const seen: string[] = [];
    limitImpl = async (id) => {
      seen.push(id);
      return { success: true };
    };
    await checkOrderPageViewRateLimit(null, "INC-1");
    expect(seen).toEqual(["INC-1"]);
  });
});
