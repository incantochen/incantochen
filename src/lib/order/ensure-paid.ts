import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendOrderConfirmation } from "@/lib/email/order-confirmation";
import { sendNewOrderNotification } from "@/lib/email/new-order-notification";
import { sendOnce } from "@/lib/notification/send-once";
import { PAID_LINEAGE, type OrderStatus } from "@/lib/order/order-status";

// 付款期間 cart 被加入新品項時的精準清理：只刪除訂單裡出現過的 cart_item
// （product_id + config_snapshot 完全一致），新加入的保留。cart_item 與
// order_item 之間沒有外鍵對應，這是能做到的最準確比對。
async function removePurchasedItemsFromCart(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
  cartId: string,
) {
  const [orderItemsRes, cartItemsRes] = await Promise.all([
    serviceRole
      .from("order_item")
      .select("product_id, config_snapshot")
      .eq("order_id", orderId),
    serviceRole
      .from("cart_item")
      .select("id, product_id, config_snapshot")
      .eq("cart_id", cartId),
  ]);

  if (orderItemsRes.error || cartItemsRes.error) {
    const error = orderItemsRes.error ?? cartItemsRes.error;
    console.error(
      "[ensureOrderPaid] purchased-item cleanup query failed",
      error,
    );
    Sentry.captureMessage("ensureOrderPaid: purchased-item cleanup failed", {
      level: "error",
      extra: { orderId, cartId, error: error?.message },
    });
    return;
  }

  const purchasedKeys = new Set(
    (orderItemsRes.data ?? []).map(
      (i) => `${i.product_id}|${JSON.stringify(i.config_snapshot)}`,
    ),
  );
  const idsToRemove = (cartItemsRes.data ?? [])
    .filter((c) =>
      purchasedKeys.has(`${c.product_id}|${JSON.stringify(c.config_snapshot)}`),
    )
    .map((c) => c.id);

  if (idsToRemove.length === 0) return;

  const { error: removeError } = await serviceRole
    .from("cart_item")
    .delete()
    .in("id", idsToRemove);
  if (removeError) {
    console.error(
      "[ensureOrderPaid] purchased-item delete failed",
      removeError,
    );
    Sentry.captureMessage("ensureOrderPaid: purchased-item delete failed", {
      level: "error",
      extra: { orderId, cartId, error: removeError.message },
    });
  }
}

async function notifyOrderPaid(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
): Promise<boolean> {
  // sendOnce 保證不往外拋例外，兩通知彼此獨立，可安全平行處理。
  // 兩封皆確認送達（true）才回 true；任一封 send() 失敗（false）即回 false，
  // 讓上游（webhook）觸發 ECPay 重送，重送時 reclaim 機制會補寄失敗那封（T88）。
  const [confirmationOk, notificationOk] = await Promise.all([
    sendOnce(serviceRole, {
      orderId,
      type: "order_confirmation",
      send: () => sendOrderConfirmation(orderId),
    }),
    sendOnce(serviceRole, {
      orderId,
      type: "new_order_notification",
      send: () => sendNewOrderNotification(orderId),
    }),
  ]);
  return confirmationOk && notificationOk;
}

// source 標示這次推進是被誰觸發（"webhook" 或 T89 的 "reconcile"），寫進
// order_status_log.note 供稽核——區分「webhook 正常推進」與「靠對帳兜底才推進」，
// 後者代表 webhook 當初失靈過，是 T90 runbook 判斷 webhook 可靠度的依據。
export async function ensureOrderPaid(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
  source: string,
) {
  // 條件式 UPDATE：只有真正搶到這次推進的請求才會拿到 promoted，
  // 避免兩個近乎同時抵達的重送請求都各自寫入 order_status_log（該表無 unique 約束）。
  // 訂單若已經是 paid（例如上次執行已推進成功、但通知半路失敗），這裡安全地
  // 不做任何事——推進與寄通知是兩件互不依賴、各自冪等的事，見 ensureNotificationSent。
  const { data: promoted, error } = await serviceRole
    .from("orders")
    .update({ status: "paid" })
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .select("id, cart_id, created_at")
    .maybeSingle();

  // Supabase 對 statement timeout／連線池耗盡等暫時性錯誤不會 throw，只回傳
  // { error }；若不檢查，會跟「沒符合更新條件」混淆而靜默跳過，害呼叫端回
  // 成功讓上游不再重試，訂單就永遠卡在 pending_payment（明明已經付款）。
  if (error) throw new Error(`ensureOrderPaid failed: ${error.message}`);
  if (!promoted) {
    // 沒搶到 CAS：多數情況是「已經是 paid」的正常冪等重入（見上方註解）。
    // 但 T66 的 72h 逾期自動取消 cron 上線後，多了一種危險狀況——訂單被
    // cron 搶先轉成 cancelled，此時 ECPay 那邊實際上已經付款成功。這種
    // 「錢收到了、但訂單卡在 cancelled」必須告警，不能跟正常冪等重入混淆
    // 而悄悄放過。
    // 這段的存在意義就是「不要靜默」，所以重查失敗（error）或查無此單
    // （current 為 null）同樣要告警——只有明確確認「已是 paid」才安靜返回。
    const { data: current, error: statusError } = await serviceRole
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .maybeSingle();
    if (statusError || !current || current.status !== "paid") {
      const status = statusError
        ? `查詢失敗: ${statusError.message}`
        : (current?.status ?? "查無此訂單");
      console.error(
        "[ensureOrderPaid] order 未處於 pending_payment 亦無法確認為 paid，付款可能卡住",
        { orderId, status, source },
      );
      Sentry.captureMessage(
        "ensureOrderPaid: order in unexpected status, payment may be stuck",
        { level: "error", extra: { orderId, status, source } },
      );
    }
    return;
  }

  const { error: logError } = await serviceRole
    .from("order_status_log")
    .insert({
      order_id: orderId,
      from_status: "pending_payment",
      to_status: "paid",
      note: `ECPay ${source}`,
      actor_id: null,
      is_override: false,
    });
  if (logError) {
    console.error("[order_status_log] insert failed", logError);
    Sentry.captureMessage("[order_status_log] insert failed", {
      level: "error",
      extra: { orderId, logError },
    });
  }

  // T75：付款成功才清購物車（下單當下保留，避免付款失敗要重配置）。清車失敗
  // 只記錄不拋錯，比照 touchCartUpdatedAt 的容錯層級——這是次要清理，不應擋住
  // 付款確認流程。
  //
  // 只在 cart 於「下單之後沒被再動過」時才整張刪除：下單後、付款前這段期間
  // cart 仍是活的（同一顆 guest_token 對應同一張 cart，T78 已加 unique），
  // 客人可能開新分頁又加了別的商品進同一張 cart——這些從未結進這筆訂單的
  // 品項不該被這次付款確認一起刪掉。cart.updated_at 只要有新增/修改
  // cart_item 就會被 touch，拿它跟訂單建立時間比較即可判斷。
  if (promoted.cart_id) {
    const { data: cartRow, error: cartFetchError } = await serviceRole
      .from("cart")
      .select("updated_at")
      .eq("id", promoted.cart_id)
      .maybeSingle();

    if (cartFetchError) {
      console.error("[ensureOrderPaid] cart 查詢失敗", cartFetchError);
      Sentry.captureMessage("ensureOrderPaid: cart fetch failed", {
        level: "error",
        extra: {
          orderId,
          cartId: promoted.cart_id,
          error: cartFetchError.message,
        },
      });
    } else if (cartRow && cartRow.updated_at <= promoted.created_at) {
      const { error: cartError } = await serviceRole
        .from("cart")
        .delete()
        .eq("id", promoted.cart_id);
      if (cartError) {
        console.error("[ensureOrderPaid] cart delete failed", cartError);
        Sentry.captureMessage("ensureOrderPaid: cart delete failed", {
          level: "error",
          extra: {
            orderId,
            cartId: promoted.cart_id,
            error: cartError.message,
          },
        });
      }
    } else if (cartRow) {
      // 下單後 cart 又被動過（付款期間加了新商品）：整張保留會讓「已付款的
      // 品項」繼續留在購物車，客人下次結帳會把買過的東西再買一次。改成只
      // 移除這筆訂單裡出現過的品項（以 product_id + config_snapshot 比對），
      // 下單後才加入的新品項原樣保留。best-effort：失敗只告警不擋付款確認。
      await removePurchasedItemsFromCart(
        serviceRole,
        orderId,
        promoted.cart_id,
      );
    }
  }
}

// 回傳 boolean（T88）：true = 通知已送達或無事可寄；false = 訂單為 paid 但
// 至少一封信真的沒寄出。呼叫端（webhook）可據此對 ECPay 回錯誤觸發重送，
// 讓下次重送走 reclaim 補寄。狀態查詢的 { error } 仍照舊 throw（次要 DB 故障
// 由 webhook 最外層 catch 成 ERR，行為與現況一致）。
export async function ensureNotificationSent(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
): Promise<boolean> {
  // 不依賴呼叫者是否剛推進成功，重新查一次目前狀態：無論是這次才推進、
  // 還是先前已經推進但通知沒寄成功，只要付款確實成立過就補寄。
  // 判斷用 PAID_LINEAGE（paid 與其後續狀態）而非只認 paid：訂單可能在
  // ECPay 下一次重送抵達前就被推進到製作／出貨，只認 paid 會把失敗信件
  // 的重試靜默切斷（T88 review）。cancelled／refunded／pending_payment
  //（含查無此單）不寄，避免對已取消／退款的訂單誤發「訂單確認」信。
  const { data: order, error } = await serviceRole
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new Error(`ensureNotificationSent failed: ${error.message}`);

  if (!order || !PAID_LINEAGE.includes(order.status as OrderStatus)) {
    // 付款未成立或不該寄：沒有要寄的信，視為成功。
    return true;
  }

  return notifyOrderPaid(serviceRole, orderId);
}
