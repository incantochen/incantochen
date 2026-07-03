import "server-only";
import { randomUUID } from "crypto";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";

type ServiceRole = ReturnType<typeof createServiceRoleClient>;

type ClaimResult = "claimed" | "conflict" | "unknown";

// stale pending 門檻：安全超過任何合理的 serverless function 執行時間，
// 用來判斷「這筆 pending 是真的還在處理中，還是 process 被砍斷卡住了」。
const STALE_PENDING_MS = 2 * 60 * 1000;

// notification(order_id, type) 有 unique constraint（T69）：
// insert 先佔位 status='pending'，send() 完成才回填 sent/failed，
// 避免「insert 成功但送信失敗」被誤判為已寄出、之後 webhook 重送也不會再試。
//
// 呼叫這支函式時，訂單／付款多半已經標記 paid：往後任何 webhook 重送都會被
// 冪等短路擋在最前面、不會再進到這裡，所以這支函式本身必須保證絕對不往外
// 拋例外——內部任何一步（DB 讀寫、送信）失敗都只能記 log、絕不能讓例外
// 傳出去影響 webhook 的回應，否則會造成通知永久遺失且無法重試。
export async function sendOnce(
  serviceRole: ServiceRole,
  params: { orderId: string; type: string; send: () => Promise<void> },
): Promise<void> {
  try {
    await sendOnceInner(serviceRole, params);
  } catch (e) {
    console.error("[notification] sendOnce 發生未預期例外", params.type, e);
  }
}

async function sendOnceInner(
  serviceRole: ServiceRole,
  params: { orderId: string; type: string; send: () => Promise<void> },
): Promise<void> {
  const { orderId, type, send } = params;
  const id = randomUUID();

  const claim = await tryClaim(serviceRole, id, orderId, type);

  if (claim === "claimed") return attemptSend(serviceRole, id, send);

  if (claim === "unknown") {
    // 無法建立去重紀錄（DB 暫時性故障）：此時訂單多半已標記 paid，
    // 之後的 webhook 重送會被冪等短路擋掉、永遠不會再呼叫這裡。
    // 寧可 best-effort 直接寄一次（極端情況下可能重複），也不要讓信永久消失。
    await send().catch((e) => {
      console.error("[notification] best-effort send failed", type, e);
    });
    return;
  }

  // conflict：已有紀錄。用條件式 UPDATE 原子性地把 failed 轉回 pending 才重試，
  // 避免兩個並發請求同時讀到 failed、都各自呼叫 send() 造成重複寄信。
  let reclaimed = await tryReclaim(serviceRole, orderId, type, (q) =>
    q.eq("status", "failed"),
  );

  if (!reclaimed) {
    // 找不到 failed 可撿：再試著撿「pending 太久」的紀錄——process 可能在
    // attemptSend 執行到一半就被砍斷（serverless 執行時間上限等），導致
    // 卡在 pending 永遠沒人處理。created_at 早於門檻才視為卡住，避免誤
    // 撿到真的還在處理中的並發請求（那個情境已由上面的 failed reclaim
    // 與最初的 claim insert 保護）。
    const staleThreshold = new Date(
      Date.now() - STALE_PENDING_MS,
    ).toISOString();
    reclaimed = await tryReclaim(serviceRole, orderId, type, (q) =>
      q.eq("status", "pending").lt("created_at", staleThreshold),
    );
  }

  if (!reclaimed) return;
  return attemptSend(serviceRole, reclaimed.id, send);
}

async function tryReclaim(
  serviceRole: ServiceRole,
  orderId: string,
  type: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withCondition: (query: any) => any,
): Promise<{ id: string } | null> {
  const query = serviceRole
    .from("notification")
    .update({ status: "pending" })
    .eq("order_id", orderId)
    .eq("type", type);
  const { data } = await withCondition(query).select("id").maybeSingle();
  return data ?? null;
}

async function tryClaim(
  serviceRole: ServiceRole,
  id: string,
  orderId: string,
  type: string,
): Promise<ClaimResult> {
  try {
    const { error } = await serviceRole.from("notification").insert({
      id,
      order_id: orderId,
      channel: "email",
      type,
      status: "pending",
    });
    if (!error) return "claimed";
    if (error.code === "23505") return "conflict";
    console.error("[notification] insert failed", type, error);
    return "unknown";
  } catch (e) {
    console.error("[notification] insert threw", type, e);
    return "unknown";
  }
}

async function attemptSend(
  serviceRole: ServiceRole,
  notificationId: string,
  send: () => Promise<void>,
): Promise<void> {
  try {
    await send();
  } catch (e) {
    console.error("[notification] send failed", e);
    await serviceRole
      .from("notification")
      .update({ status: "failed" })
      .eq("id", notificationId);
    return;
  }

  // send() 已成功：這裡萬一失敗也不能回頭標成 failed（會誤導成「沒寄到」）。
  // 頂多留在 pending，之後的去重邏輯只會跳過、不會重寄，不會造成重複寄信。
  try {
    await serviceRole
      .from("notification")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", notificationId);
  } catch (e) {
    console.error(
      "[notification] failed to record sent status (email was delivered)",
      e,
    );
  }
}
