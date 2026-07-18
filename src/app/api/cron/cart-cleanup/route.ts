import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireCronAuth } from "@/lib/cron/require-cron-auth";

const GUEST_CART_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
// 對齊 ecpay-reconcile 的候選上限量級（該處各臂為 20–30）：避免首次上線
// （累積已久的訪客車 backlog）或排程中斷數日後，單次 DELETE 掃過大範圍拖慢／
// 鎖住 cart 表；超過上限的部分留給隔天同一支 cron 接著清（依 updated_at 由舊
// 到新，訪客車清理無時間敏感度，慢速排空可接受）。
//
// 上限刻意壓低的第二個理由（T134）：守衛式 DELETE 用 `.in("id", ids)`，
// postgrest-js 會把整份 id 清單序列化進 URL query。500 個 UUID ≈ 19KB，
// 恰在批量最大（積壓）時可能撞 PostgREST／Kong gateway 或 Node header buffer
// 上限致 414／請求被丟棄——那天該批 DELETE 0、零清理。50 個 UUID ≈ 2KB，
// 遠低於任何 gateway 上限。無外部 API 節流，故比 reconcile 的 30 略高。
// export 供測試斷言 SELECT 確有套上批量上限（避免測試手刻魔術數字，日後
// 調上限時測試才不會以 `50 to be 500` 這種無指向的失敗誤導維護者）。
export const CLEANUP_BATCH_LIMIT = 50;

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
    // 多撈一筆（+1）以精準偵測積壓：撈到 > CLEANUP_BATCH_LIMIT 才代表單日到期
    // 車數超出單輪批量、有殘量留待隔日（比照 ecpay-reconcile 漂移臂的 limit+1
    // 探測，避免「恰好等於上限、後面沒有更多」誤觸截斷告警）。本輪只處理前
    // CLEANUP_BATCH_LIMIT 筆，多撈那筆下輪再清。
    const { data: rows, error: selectError } = await serviceRole
      .from("cart")
      .select("id")
      .is("member_id", null)
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(CLEANUP_BATCH_LIMIT + 1);

    if (selectError) {
      throw new Error(`cart cleanup 候選查詢失敗: ${selectError.message}`);
    }

    // 撈滿即截斷：單日到期訪客車 > 批量上限，殘量留隔日同一支 cron 續清。
    // 不再無聲——若持續棄車 > 上限／日，訪客車與 cart_item 會靜靜積壓到 DB
    // 容量／效能才被發現；比照 ecpay-reconcile 的 driftTruncated 告警慣例。
    const truncated = (rows?.length ?? 0) > CLEANUP_BATCH_LIMIT;
    if (truncated) {
      Sentry.captureMessage(
        "cart-cleanup: 到期訪客車積壓超過批量上限，殘量留隔日",
        { level: "warning", extra: { batchLimit: CLEANUP_BATCH_LIMIT } },
      );
    }

    const ids = (rows ?? []).slice(0, CLEANUP_BATCH_LIMIT).map((c) => c.id);
    if (ids.length === 0) {
      return Response.json({ deleted: 0, truncated: false });
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

    return Response.json({ deleted: (data ?? []).length, truncated });
  } catch (e) {
    console.error("[cart-cleanup] unhandled error", e);
    Sentry.captureException(e);
    return Response.json({ deleted: 0 }, { status: 500 });
  }
}
