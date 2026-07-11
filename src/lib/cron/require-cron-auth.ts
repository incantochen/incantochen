import "server-only";
import { serverEnv } from "@/lib/env.server";

// 三支 cron route（cart-cleanup／ecpay-reconcile／pending-payment-expire）
// 共用同一套 CRON_SECRET bearer-token 驗證，避免各自重複實作、未來要改驗證
// 方式（例如換 Vercel 內建的 cron signature header）時漏改其中一份。
export function requireCronAuth(request: Request): Response | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
