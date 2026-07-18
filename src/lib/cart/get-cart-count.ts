import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  resolveCartIdentity,
  findCartByIdentity,
} from "@/lib/cart/resolve-cart-identity";

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
  // T81：resolver 決定身分（登入→member、訪客→guest）。徽章屬裝飾性——任一
  // 步驟失敗（含 getUser 因 DB 故障 throw、cart／count 查詢 error）一律 fail-soft：
  // 記 Sentry＋回 0，不讓全站 header 一起掛（T95／§6，不得完全靜默）。
  try {
    const identity = await resolveCartIdentity();
    if (identity.kind === "none") return 0;

    const serviceRole = createServiceRoleClient();
    const { data: cart, error: cartError } = await findCartByIdentity(
      serviceRole,
      identity,
    );

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
  } catch (e) {
    await captureCartCountFailure(e);
    return 0;
  }
}
