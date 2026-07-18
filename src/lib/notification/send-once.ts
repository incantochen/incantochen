import "server-only";
import * as Sentry from "@sentry/nextjs";
import { randomUUID } from "crypto";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PG_UNIQUE_VIOLATION } from "@/lib/supabase/postgres-error-codes";

type ServiceRole = ReturnType<typeof createServiceRoleClient>;

type ClaimResult = "claimed" | "conflict" | "unknown";

// stale pending 門檻：安全超過任何合理的 serverless function 執行時間，
// 用來判斷「這筆 pending 是真的還在處理中，還是 process 被砍斷卡住了」。
const STALE_PENDING_MS = 2 * 60 * 1000;

// notification(order_id, type) 有 unique constraint（T69）：
// insert 先佔位 status='pending'，send() 完成才回填 sent/failed，
// 避免「insert 成功但送信失敗」被誤判為已寄出、之後 webhook 重送也不會再試。
//
// 這支函式本身必須保證絕對不往外拋例外——內部任何一步（DB 讀寫、送信）失敗
// 都只能記 log、絕不能讓例外傳出去影響 webhook 的回應。
//
// 回傳 boolean 而非 throw（T88）：`false` 代表「無法確認信已送達」（send()
// 拋錯、或 DB 狀態無法確認），在意的呼叫端（webhook）可據此對 ECPay 回錯誤
// 以觸發重送，重送時 reclaim 機制會補寄；每日 reconcile cron 的 failed sweep
// 是最終兜底。其餘一律 `true`（已送出／重複已寄／無事可做）。
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
    // 無法建立去重紀錄（DB 暫時性故障）：寧可 best-effort 直接寄一次，
    // 也不要讓信永久消失。
    try {
      await send();
    } catch (e) {
      console.error("[notification] best-effort send failed", type, e);
      Sentry.captureException(e, { extra: { orderId, type } });
      // 信沒送出 → false 讓上游重送重試。
      return false;
    }
    // 信已送出：補寫一筆 status='sent' 的去重紀錄。T88 之後 webhook 重送
    // 會再進到這裡（兄弟信失敗即觸發 ERR 重送），沒有這筆錨點的話每一輪
    // 重送都會把這封信重寄一次。insert 失敗只記錄——這個情境 DB 本來就在
    // 故障（第一次 insert 才會走到 unknown），resolve {error} 或直接 throw
    // 都可能發生，兩者都不得影響回傳值：信已送達，必須回 true。
    try {
      const { error: recordError } = await serviceRole
        .from("notification")
        .insert({
          id,
          order_id: orderId,
          channel: "email",
          type,
          status: "sent",
          sent_at: new Date().toISOString(),
        });
      if (recordError && recordError.code !== PG_UNIQUE_VIOLATION) {
        console.error(
          "[notification] best-effort dedup record failed (email was delivered)",
          type,
          recordError,
        );
      }
    } catch (e) {
      console.error(
        "[notification] best-effort dedup record threw (email was delivered)",
        type,
        e,
      );
    }
    return true;
  }

  // conflict：已有紀錄。先查目前狀態——最常見的情境是重複 webhook 撞上
  // 已寄出的通知，一次 SELECT 即可短路，免去固定打兩發 reclaim UPDATE。
  const status = await fetchStatus(serviceRole, orderId, type);
  if (status === "sent") return true;
  // 查詢失敗（fetchStatus 已記錄）：無法確認送達，回 false 讓上游重試。
  if (status === null) return false;

  // 用條件式 UPDATE 原子性地 reclaim 才重試，避免兩個並發請求同時讀到
  // failed／stale pending、都各自呼叫 send() 造成重複寄信。
  let reclaimed: { id: string } | null = null;
  if (status === "failed") {
    reclaimed = await tryReclaim(serviceRole, orderId, type, (q) =>
      q.eq("status", "failed"),
    );
  } else if (status === "pending") {
    // pending 太久＝process 可能在 attemptSend 執行到一半被砍斷（serverless
    // 執行時間上限等），卡住永遠沒人處理。created_at 早於門檻才視為卡住，
    // 避免誤撿到真的還在處理中的並發請求。
    const staleThreshold = new Date(
      Date.now() - STALE_PENDING_MS,
    ).toISOString();
    reclaimed = await tryReclaim(serviceRole, orderId, type, (q) =>
      q.eq("status", "pending").lt("created_at", staleThreshold),
    );
  }

  if (!reclaimed) {
    // 沒 reclaim 到：可能剛被另一個並發請求搶走、或是新鮮 pending 還在
    // 處理中，結果此刻未知。再確認一次：只有 sent 才算成功，其餘一律回
    // false 讓上游有機會再次確認——reclaim 有去重＋stale 門檻保護，多一輪
    // 不必要的重送不會造成重複寄信（代價只是偶發一輪空轉，接受）。
    return (await fetchStatus(serviceRole, orderId, type)) === "sent";
  }
  return attemptSend(serviceRole, reclaimed.id, send);
}

// 查 notification 目前狀態。回 null＝「查詢失敗或查無資料」——conflict 之後
// 資料列必然存在，所以 null 實務上就是查詢失敗，呼叫端一律當「無法確認送達」
// 處理（回 false 讓上游重試）。
async function fetchStatus(
  serviceRole: ServiceRole,
  orderId: string,
  type: string,
): Promise<string | null> {
  const { data, error } = await serviceRole
    .from("notification")
    .select("status")
    .eq("order_id", orderId)
    .eq("type", type)
    .maybeSingle();
  if (error) {
    // §6：「查詢失敗」≠「查無資料」。這裡的失敗會讓上游觸發重送，必須留下
    // 記錄，否則 DB 故障引發的重送完全無法觀測、也無從與真實寄信失敗區分。
    console.error("[notification] status query failed", type, error);
    Sentry.captureMessage("sendOnce: notification status query failed", {
      level: "warning",
      extra: { orderId, type, error: error.message },
    });
    return null;
  }
  return data?.status ?? null;
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
  const { data, error } = await withCondition(query).select("id").maybeSingle();
  if (error) {
    // reclaim 失敗（DB 暫時性錯誤）：當作沒搶到即可（呼叫端會走狀態複查），
    // 但要記錄，避免 DB 故障與「被並發搶走」混在一起無法追查。
    console.error("[notification] reclaim update failed", type, error);
    Sentry.captureMessage("sendOnce: reclaim update failed", {
      level: "warning",
      extra: { orderId, type, error: error.message },
    });
    return null;
  }
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
    if (error.code === PG_UNIQUE_VIOLATION) return "conflict";
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
    // 標記 failed 讓之後的 reclaim／每日 sweep 能重試。.eq("status","pending")
    // 守衛：stale-reclaim 可能產生並發雙寄手，若另一方已寄成標了 sent，這裡
    // 絕不能把 sent 蓋回 failed（會誤導成沒寄到、招來重複寄送）。
    const { error: markError } = await serviceRole
      .from("notification")
      .update({ status: "failed" })
      .eq("id", notificationId)
      .eq("status", "pending");
    // supabase-js 對 DB 錯誤是 resolve { error } 不 throw：不檢查的話這裡
    // 靜默失敗，row 停在新鮮 pending，上游重送在 stale 門檻前全數空轉
    // （reclaim 不到 failed、pending 又不夠老）。記錄之，回傳值不變。
    if (markError) {
      console.error("[notification] mark-failed update failed", markError);
      Sentry.captureMessage("sendOnce: mark-failed update failed", {
        level: "warning",
        extra: { notificationId, error: markError.message },
      });
    }
    // send() 拋錯：信真的沒送出，回 false 讓上游觸發重送。
    return false;
  }

  // send() 已成功：這裡萬一失敗也不能回頭標成 failed（會誤導成「沒寄到」）。
  // 頂多留在 pending——但這代表「send() 成功、只是回填 sent 失敗」跟「process
  // 被砍斷、send() 根本沒跑完」在資料庫裡是同一種狀態，無法區分。超過
  // STALE_PENDING_MS 後的 reclaim 機制會把這種 pending 當成「卡住」而重新
  // 寄送，所以此處的失敗理論上仍可能造成一次重複寄信（機率低）。這是目前
  // 設計已知、刻意接受的殘餘風險，優於「永久不重試、信件真的漏寄」。
  try {
    const { error: sentError } = await serviceRole
      .from("notification")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", notificationId);
    if (sentError) {
      // DB 錯誤是 resolve { error } 不 throw，舊版只靠 catch 攔不到這個
      // 失敗模式（catch 對它是死碼）——必須明確檢查才有記錄。
      console.error(
        "[notification] failed to record sent status (email was delivered)",
        sentError,
      );
      Sentry.captureMessage(
        "sendOnce: record-sent update failed (email delivered)",
        {
          level: "warning",
          extra: { notificationId, error: sentError.message },
        },
      );
    }
  } catch (e) {
    console.error(
      "[notification] failed to record sent status (email was delivered)",
      e,
    );
  }

  // send() 成功（無論回填 sent 是否成功）：信已送達。
  return true;
}
