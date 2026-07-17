import "server-only";
import { serverEnv } from "@/lib/env.server";
import { timingSafeEqualStrings } from "@/lib/timing-safe-equal";

// 三支 cron route（cart-cleanup／ecpay-reconcile／pending-payment-expire）
// 共用同一套 CRON_SECRET bearer-token 驗證，避免各自重複實作、未來要改驗證
// 方式（例如換 Vercel 內建的 cron signature header）時漏改其中一份。
// T99（F-012）：secret 比對走共用 timingSafeEqualStrings（sha256 digest
// 比對，長度不洩漏）——`Bearer ${CRON_SECRET}` 的長度本身即秘密，不可用
// 「長度不等即 return false」那種會洩漏長度的比對。
export function requireCronAuth(request: Request): Response | null {
  const authHeader = request.headers.get("authorization");
  if (
    authHeader === null ||
    !timingSafeEqualStrings(authHeader, `Bearer ${serverEnv.CRON_SECRET}`)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
