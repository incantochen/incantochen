import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";

// T78：cart_item 的 insert/update/delete 不會連帶更新父層 cart.updated_at
// （0001 migration 的 trigger 各自獨立），90 天訪客車清理排程依賴這個欄位判斷
// 「還活著」，故每次購物車活動都要手動 touch。失敗只記錄不上拋——這是清理
// 排程的防呆機制，不應讓使用者原本已成功的加車/改量/移除操作失敗。
export async function touchCartUpdatedAt(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  cartId: string,
) {
  const { error } = await serviceRole
    .from("cart")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", cartId);

  if (error) {
    console.error("[touchCartUpdatedAt] update failed", error);
    Sentry.captureMessage("touchCartUpdatedAt: update failed", {
      level: "error",
      extra: { cartId, error: error.message },
    });
  }
}
