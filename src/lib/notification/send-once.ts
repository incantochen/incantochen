import "server-only";
import * as Sentry from "@sentry/nextjs";
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
//
// 回傳 boolean 而非 throw（T88）：`false` 只代表「真的嘗試寄信但 send() 拋錯
// （信沒送出）」，在意的呼叫端（webhook）可據此對 ECPay 回錯誤以觸發重送，
// 重送時上面的 reclaim 機制就會補寄。其餘一律 `true`（已送出／重複已寄／
// 無事可做）。仍不往外拋例外，維持出貨 best-effort 呼叫端的契約。
export async function sendOnce(
  serviceRole: ServiceRole,
  params: { orderId: string; type: string; send: () => Promise<void> },
): Promise<boolean> {
  try {
    return await sendOnceInner(serviceRole, params);
  } catch (e) {
    console.error("[notification] sendOnce 發生未預期例外", params.type, e);
    Sentry.captureException(e, {
      extra: { orderId: params.orderId, type: params.type },
    });
    // 非預期例外：無法確認是否送達，偏向回 false 讓上游重送重試。
    return false;
  }
}

async function sendOnceInner(
  serviceRole: ServiceRole,
  params: { orderId: string; type: string; send: () => Promise<void> },
): Promise<boolean> {
  const { orderId, type, send } = params;
  const id = randomUUID();

  const claim = await tryClaim(serviceRole, id, orderId, type);

  if (claim === "claimed") return attemptSend(serviceRole, id, send);

  if (claim === "unknown") {
    // 無法建立去重紀錄（DB 暫時性故障）：此時訂單多半已標記 paid，
    // 之後的 webhook 重送會被冪等短路擋掉、永遠不會再呼叫這裡。
    // 寧可 best-effort 直接寄一次（極端情況下可能重複），也不要讓信永久消失。
    // 送出 → true；send() 拋錯（信沒送出）→ false 讓上游重送重試。
    return send()
      .then(() => true)
      .catch((e) => {
        console.error("[notification] best-effort send failed", type, e);
        return false;
      });
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

  if (!reclaimed) {
    // 沒 reclaim 到：可能已經真的送達（status=sent），也可能是另一個並發
    // 請求正在處理中（status 仍是新鮮的 pending，尚未跨過 stale 門檻）。
    // 後者的結果此刻未知——若直接回 true，等於樂觀假設對方一定會成功；
    // 但這個回傳值現在會被 webhook 用來決定要不要讓 ECPay 重送（T88），
    // 樂觀假設錯了就會把一次真正的寄信失敗回報成功、永遠沒有人再重試。
    // 查一次目前狀態才誠實：只有確認 sent 才算成功，其餘一律回 false
    // 讓上游有機會再次確認——reclaim 有去重＋stale 門檻保護，不會因為
    // 多一次不必要的重送就造成重複寄信。
    const { data: current } = await serviceRole
      .from("notification")
      .select("status")
      .eq("order_id", orderId)
      .eq("type", type)
      .maybeSingle();
    return current?.status === "sent";
  }
  return attemptSend(serviceRole, reclaimed.id, send);
}

async function tryReclaim(
  serviceRole: ServiceRole,
  orderId: string,
  type: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withCondition: (query: any) => any,
): Promise<{ id: string } | null> {
  // SET 一併更新 created_at（一個 WHERE 有用到的欄位）：若兩個並發請求同時
  // reclaim 同一筆卡住的紀錄，第一個成功後，第二個重新檢查 WHERE 條件
  // （Postgres EvalPlanQual）會因為 created_at 已經變成剛剛的時間、不再早於
  // staleThreshold 而落空，避免兩邊都搶到、都重寄一次。
  const query = serviceRole
    .from("notification")
    .update({ status: "pending", created_at: new Date().toISOString() })
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
): Promise<boolean> {
  try {
    await send();
  } catch (e) {
    console.error("[notification] send failed", e);
    Sentry.captureException(e, { extra: { notificationId } });
    await serviceRole
      .from("notification")
      .update({ status: "failed" })
      .eq("id", notificationId);
    // send() 拋錯：信真的沒送出，回 false 讓上游觸發重送。
    return false;
  }

  // send() 已成功：這裡萬一失敗也不能回頭標成 failed（會誤導成「沒寄到」）。
  // 頂多留在 pending——但這代表「send() 成功、只是回填 sent 失敗」跟「process
  // 被砍斷、send() 根本沒跑完」在資料庫裡是同一種狀態（都是 pending、
  // sent_at 皆為 null，因為兩者是同一個 UPDATE 語句一起寫入），無法區分。
  // 超過 STALE_PENDING_MS 後的 reclaim 機制會把這種 pending 當成「卡住」而
  // 重新寄送，所以此處的失敗理論上仍可能造成一次重複寄信（機率低：需要
  // send 成功但這個 UPDATE 恰好失敗，且之後真的有請求在 2 分鐘後重新
  // 觸發同一筆通知）。這是目前設計已知、刻意接受的殘餘風險，優於「永久
  // 不重試、信件真的漏寄」。
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
    // 回填 sent 失敗屬次要環節，信已送達 → 仍回 true，不誤判成沒寄到。
  }

  // send() 成功（無論回填 sent 是否成功）：信已送達。
  return true;
}
