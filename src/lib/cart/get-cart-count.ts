import "server-only";
import * as Sentry from "@sentry/nextjs";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// 同一故障窗內只回報一次：DB 故障時每個 pageview 的 header 都會走 fail-soft
// 分支，若每次都 capture+flush 會在故障期間對 Sentry 噴洪水（且每發都多等
// 一趟 flush）。module-scope 節流讓 60s 內至多送一發，可觀測性足夠。
let lastCaptureAt = 0;
const CAPTURE_THROTTLE_MS = 60_000;

async function captureCartCountFailure(err: unknown): Promise<void> {
  const now = Date.now();
  if (now - lastCaptureAt < CAPTURE_THROTTLE_MS) return;
  lastCaptureAt = now;
  Sentry.captureException(err, {
    tags: { area: "cart-count", failMode: "fail-soft" },
  });
  // 這裡不是 route handler（無平台 waitUntil 兜底），且 fail-soft 後立刻
  // return——serverless function 可能在 auto-flush 送出前被凍結，故主動 flush
  // 確保這發告警真的離開（§6：serverless 禁 fire-and-forget）。
  await Sentry.flush(2000);
}

export async function getCartCount(): Promise<number> {
  const cookieStore = await cookies();
  const guestToken = cookieStore.get("guest_token")?.value;
  if (!guestToken) return 0;

  const serviceRole = createServiceRoleClient();
  const { data: cart, error: cartError } = await serviceRole
    .from("cart")
    .select("id")
    .eq("guest_token", guestToken)
    .maybeSingle();

  // T95（F-008）：徽章屬裝飾性——DB 故障時 throw 會讓全站 header 一起掛，
  // 故 fail-soft 回 0；但必須記 Sentry 保留可觀測性，不得完全靜默（§6）。
  if (cartError) {
    await captureCartCountFailure(cartError);
    return 0;
  }

  if (!cart) return 0;

  const { count, error: countError } = await serviceRole
    .from("cart_item")
    .select("*", { count: "exact", head: true })
    .eq("cart_id", cart.id);

  if (countError) {
    await captureCartCountFailure(countError);
    return 0;
  }

  return count ?? 0;
}
