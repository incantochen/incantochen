import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireCronAuth } from "@/lib/cron/require-cron-auth";

const GUEST_CART_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
// 比照 ecpay-reconcile 的 CANDIDATE_LIMIT：避免首次上線（累積已久的訪客車
// backlog）或排程中斷數日後，單次 DELETE 掃過大範圍拖慢／鎖住 cart 表；
// 超過上限的部分留給隔天同一支 cron 接著清（依 updated_at 由舊到新）。
// export 供測試斷言 SELECT 確有套上批量上限（避免測試手刻魔術數字 500，
// 日後調上限時測試才不會以 `1000 to be 500` 這種無指向的失敗誤導維護者）。
export const CLEANUP_BATCH_LIMIT = 500;

// T78：訪客購物車（member_id IS NULL）90 天未活動即清除，CASCADE 帶走 cart_item。
// cart.updated_at 由 addToCart/updateCartItemQuantity/removeCartItem 各自 touch
// 維持新鮮，故這裡只需比對時間戳，不需另外判斷 cart_item 是否還在變動。
export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const serviceRole = createServiceRoleClient();
    const cutoff = new Date(Date.now() - GUEST_CART_MAX_AGE_MS).toISOString();

    // Postgres 的 DELETE 語法不支援 ORDER BY，PostgREST 組出限制筆數的子查詢時
    // 對這個版本會回傳 42703（column does not exist）——實測驗證發現：
    // `.delete().order().limit()` 這個組合會整支失敗，拿掉 order 才會動。
    // 改成比照 ecpay-reconcile 的候選查詢模式：先 SELECT（可以安全用
    // order+limit）取出候選 id，再用 id 清單各別 DELETE。
    const { data: candidates, error: selectError } = await serviceRole
      .from("cart")
      .select("id")
      .is("member_id", null)
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(CLEANUP_BATCH_LIMIT);

    if (selectError) {
      throw new Error(`cart cleanup 候選查詢失敗: ${selectError.message}`);
    }

    const ids = (candidates ?? []).map((c) => c.id);
    if (ids.length === 0) {
      return Response.json({ deleted: 0 });
    }

    // 守衛式刪除：SELECT 取候選與 DELETE 是兩步、非原子——重跑候選條件
    // （member_id IS NULL＋updated_at < cutoff）於 DELETE 當下再判一次，
    // 讓空窗內被 addToCart/touchCartUpdatedAt 推新 updated_at（車已復活）、
    // 或登入被設 member_id（T81 兌現後）的候選車自動存活，deleted 計數如實。
    const { data, error } = await serviceRole
      .from("cart")
      .delete()
      .in("id", ids)
      .is("member_id", null)
      .lt("updated_at", cutoff)
      .select("id");

    if (error) throw new Error(`cart cleanup 刪除失敗: ${error.message}`);

    return Response.json({ deleted: (data ?? []).length });
  } catch (e) {
    console.error("[cart-cleanup] unhandled error", e);
    Sentry.captureException(e);
    return Response.json({ deleted: 0 }, { status: 500 });
  }
}
