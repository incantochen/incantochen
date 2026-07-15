import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env.server";

// T99（F-012）：secret 比對必須用常數時間比對，與同 codebase 的
// CheckMacValue／order-access-token 寫法對齊（code-checklist A4）。
// timingSafeEqual 要求兩邊長度相同，長度不同直接視為不符。
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// 三支 cron route（cart-cleanup／ecpay-reconcile／pending-payment-expire）
// 共用同一套 CRON_SECRET bearer-token 驗證，避免各自重複實作、未來要改驗證
// 方式（例如換 Vercel 內建的 cron signature header）時漏改其中一份。
export function requireCronAuth(request: Request): Response | null {
  const authHeader = request.headers.get("authorization");
  if (
    authHeader === null ||
    !safeEquals(authHeader, `Bearer ${serverEnv.CRON_SECRET}`)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
