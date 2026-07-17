import "server-only";

import { Redis } from "@upstash/redis";
import { serverEnv } from "@/lib/env.server";

// 共用 Upstash Redis client 出處。目前供 ecpay-reconcile 的「連續 403」計數用。
// 註：rate-limit.ts 另有自己的私有 client，此處刻意不動它（避免牽動 auth 限流
// 的既有測試 mock）；日後可讓 rate-limit 也改 import 此處，統一為單一 client。
export const redis = new Redis({
  url: serverEnv.UPSTASH_REDIS_REST_URL,
  token: serverEnv.UPSTASH_REDIS_REST_TOKEN,
});
