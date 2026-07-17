import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildAioParams } from "@/lib/ecpay/aio-payment";
import { generateMerchantTradeNo } from "@/lib/ecpay/merchant-trade-no";
import { findPaidPayment } from "@/lib/order/find-paid-payment";
import { serverEnv } from "@/lib/env.server";
import { getClientIp } from "@/lib/get-client-ip";
import {
  checkOrderPageViewRateLimit,
  checkOrderPayCreateRateLimit,
} from "@/lib/rate-limit";
import {
  ORDER_ACCESS_COOKIE,
  resolveOrderOwnership,
} from "@/lib/order/order-access-token";
import { RateLimitedNotice } from "../rate-limited-notice";
import { SystemBusyNotice } from "../system-busy-notice";
import { EcpayAutoSubmit } from "@/components/ecpay-auto-submit";

// T74：pending payment 超過此時限視為放棄，換發新交易序號（而非無限期復用
// 可能已被 ECPay 判定逾期的舊 trade no）。
const STALE_PAYMENT_MS = 30 * 60 * 1000;

function isPaymentFresh(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < STALE_PAYMENT_MS;
}

// 回傳 merchantTradeNo；insert 失敗（DB 暫時性故障）回 null，呼叫端據此改
// 顯示 <SystemBusyNotice />——付款中的客人不可被 redirect 踢回結帳頁（T95）。
async function createPendingPayment(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
  orderNo: string,
  totalAmount: number,
): Promise<string | null> {
  const merchantTradeNo = generateMerchantTradeNo(orderNo);
  const { data: inserted, error } = await serviceRole
    .from("payment")
    .insert({
      order_id: orderId,
      merchant_trade_no: merchantTradeNo,
      amount: totalAmount,
      provider: "ecpay",
      status: "pending",
    })
    .select("id, created_at")
    .single();
  if (error || !inserted) {
    return null;
  }

  // 併發防護：沒有 DB 層級的 unique 約束擋「同一張訂單只能有一筆 pending
  // payment」，若兩個並發請求都判定舊 row 已過期、各自 insert 了一筆新的，
  // 這裡把同訂單「比自己這筆更早建立」的 pending row 標記 failed。只掃更早
  // 的（嚴格小於自己的 created_at）——若掃「自己以外全部」，兩個併發請求會
  // 互相把對方剛發的新 row 標成 failed（mutual kill），害客人拿到的 ECPay
  // 表單對應的 payment 已死；只掃更早的保證至少最新那筆存活。
  const { data: otherPending, error: sweepQueryError } = await serviceRole
    .from("payment")
    .select("id")
    .eq("order_id", orderId)
    .eq("status", "pending")
    .lt("created_at", inserted.created_at);

  if (sweepQueryError) {
    console.error(
      "[checkout/pay] stale payment sweep query failed",
      sweepQueryError,
    );
    Sentry.captureMessage("checkout/pay: stale payment sweep query failed", {
      level: "warning",
      extra: { orderId, error: sweepQueryError.message },
    });
    return merchantTradeNo; // 清理失敗不擋付款；殘留 pending row 由對帳兜底
  }

  const staleIds = (otherPending ?? []).map((p) => p.id);
  if (staleIds.length > 0) {
    const { error: sweepError } = await serviceRole
      .from("payment")
      .update({ status: "failed" })
      .in("id", staleIds)
      .eq("status", "pending");
    if (sweepError) {
      console.error("[checkout/pay] stale payment sweep failed", sweepError);
      Sentry.captureMessage("checkout/pay: stale payment sweep failed", {
        level: "warning",
        extra: { orderId, error: sweepError.message },
      });
    }
  }

  return merchantTradeNo;
}

export default async function CheckoutPayPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderNo } = await searchParams;

  if (!orderNo) {
    redirect("/checkout");
  }

  const headersList = await headers();
  const ip = getClientIp(headersList);
  const serviceRole = createServiceRoleClient();

  // 三個互不依賴的 I/O 平行送出（Postgres 查訂單／讀 cookie／Supabase Auth
  // session）。限流改到解析擁有權「之後」只對非擁有者施加（見下方 #3），
  // 故不再放進這批平行查詢。
  const [orderResult, cookieStore, userResult] = await Promise.all([
    serviceRole
      .from("orders")
      .select("*")
      .eq("order_no", orderNo)
      .maybeSingle(),
    cookies(),
    createClient().then((c) => c.auth.getUser()),
  ]);

  const { data: order, error: orderError } = orderResult;

  // T95（F-008）：查詢失敗 ≠ 查無資料——DB 暫時性故障（timeout／連線池
  // 耗盡）不可誤判成「沒這張訂單」把付款中的客人踢回結帳頁。
  if (orderError) {
    return <SystemBusyNotice />;
  }

  if (!order) {
    redirect("/checkout");
  }

  // 已付款／非待付款 → 導頁優先於下面的擁有權檢查：這兩個分支不揭露新
  // 資訊、也不建立新 payment，必須維持既有行為不被打斷——同一瀏覽器結帳
  // 過別筆訂單、cookie 已改綁到那一筆時，回訪這筆「已經付完款」的舊連結
  // 仍要能順利導去成功頁，不能卡在「無法在此瀏覽器繼續付款」的死路。
  if (order.status === "paid") {
    redirect(`/checkout/success?order=${orderNo}`);
  }

  if (order.status !== "pending_payment") {
    redirect("/");
  }

  // T73：cookie 存在但簽章對不上這筆 order_no（且不是本人登入帳號的
  // 訂單）——代表這個瀏覽器剛結帳過別筆訂單，卻來戳這筆待付款訂單。這是
  // 唯一能安全判定「不該讓它繼續付款」的訊號，擋在讀 order_item／建立
  // payment、甚至組出可能含收件資訊的 ECPay 表單之前。cookie 缺席時維持
  // 現況放行——T111 後台代客建單的付款連結在客人裝置上本來就沒有這把
  // cookie。
  const cookieToken = cookieStore.get(ORDER_ACCESS_COOKIE)?.value;
  const {
    data: { user },
  } = userResult;
  const { ownerBySession, ownerByCookie, cookiePresentButWrong } =
    resolveOrderOwnership(cookieToken, order, user);
  const isOwner = ownerBySession || ownerByCookie;

  if (cookiePresentButWrong) {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="font-head text-2xl text-ink mb-2">
            無法在此瀏覽器繼續付款
          </h1>
          <p className="text-sm text-ash mb-8">
            這個瀏覽器目前繫結另一筆訂單。若這是要給您的付款連結，請改用無痕視窗，或換一個瀏覽器開啟。
          </p>
        </div>
      </main>
    );
  }

  // T73 code-review #3：限流只對「非擁有者」施加——擁有者（有效 cookie／
  // 登入 session）永不被限流，避免 ①success 頁 90 秒 poll 迴圈把擁有者自己
  // 鎖掉 ②攻擊者拿到 order_no 後打爆 per-order 桶把真正擁有者鎖在付款頁外。
  // 枚舉者一律非擁有者，仍受 IP＋order_no 雙維度限制，防枚舉不變。
  if (!isOwner && !(await checkOrderPageViewRateLimit(ip, orderNo))) {
    return <RateLimitedNotice />;
  }

  // 冪等：復用現有 pending payment（頁面重整不重建），
  // 付款失敗後 status 變 failed，下次進來才產生新 trade no。
  // 但 pending 超過 STALE_PAYMENT_MS 視為放棄（T74）：舊 row 標記 failed，換發新序號。
  // 兩個查詢互不依賴（都只靠 order.id），平行送出減少這個高延遲敏感頁面
  // 多等一趟 round trip 的時間。
  const [
    { data: orderItems, error: orderItemsError },
    { data: existingPending, error: existingPendingError },
  ] = await Promise.all([
    serviceRole
      .from("order_item")
      .select("quantity, product_name_snapshot, product:product_id ( name )")
      .eq("order_id", order.id),
    serviceRole
      .from("payment")
      .select("id, merchant_trade_no, created_at")
      .eq("order_id", order.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // T95（F-008）：兩個查詢任一 {error} 都停下——existingPending 讀取失敗若
  // 照走 else 分支，會在「其實已有新鮮 pending payment」時多發一筆交易序號。
  if (orderItemsError || existingPendingError) {
    return <SystemBusyNotice />;
  }

  if (!orderItems || orderItems.length === 0) {
    redirect("/checkout");
  }

  let merchantTradeNo: string;

  if (existingPending && isPaymentFresh(existingPending.created_at)) {
    merchantTradeNo = existingPending.merchant_trade_no;
  } else {
    // T73 code-review #2：pay-create 限流必須擋在任何 payment 寫入「之前」。
    // 原本擺在下方作廢舊 pending row 之後，被限流時舊 row 已標 failed、新
    // row 又沒建，訂單一度零筆有效 payment。移到 else 分支最前面確保限流時
    // 完全不動 payment 狀態。
    if (!(await checkOrderPayCreateRateLimit(ip, orderNo))) {
      return <RateLimitedNotice />;
    }

    if (existingPending) {
      // 條件式 UPDATE：WHERE 帶 status="pending" 防跟 webhook 競態——如果客人
      // 剛好在這筆「被判定放棄」的舊交易序號上完成付款，webhook 會搶先把這筆
      // payment 轉成 paid，此時這裡不該再把它蓋回 failed（CLAUDE.md §6）。
      const { data: markedFailed, error } = await serviceRole
        .from("payment")
        .update({ status: "failed" })
        .eq("id", existingPending.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) {
        // T95（F-008）：DB 暫時性故障不可把付款中的客人踢回結帳頁。
        return <SystemBusyNotice />;
      }
      if (!markedFailed) {
        // 沒搶到：這筆 payment 已經被 webhook 處理過（很可能剛好轉 paid）。
        // 重新整頁讓最上方的邏輯用最新的 order.status 重新判斷去向。
        redirect(`/checkout/pay?order=${orderNo}`);
      }
    }

    // 發新號前最後一道防呆：若這張訂單已有 paid payment（webhook 正在處理中、
    // orders.status 還沒推進的極窄窗口），絕不能再發新交易序號讓客人二次付款
    // ——導去成功頁（ensureOrderPaid 冪等，稍後 webhook 會把訂單狀態補齊）。
    // findPaidPayment 內含 { error } 檢查（會 throw）——單一出處（T127）。
    // T95（F-008）：DB 暫時性故障不可把付款中的客人踢回結帳頁——catch 回
    // SystemBusyNotice 讓客人留在原地重試（合流裁決：取 master 的 T95 語意，
    // 取代原「導回 /checkout」的寬鬆處理）。redirect() 內部以 throw 實作，
    // 故成功頁導向必須放在 try 外，否則會被 catch 誤攔成「查詢失敗」。
    let paidPayment: { id: string } | null;
    try {
      paidPayment = await findPaidPayment(serviceRole, order.id);
    } catch {
      return <SystemBusyNotice />;
    }
    if (paidPayment) {
      redirect(`/checkout/success?order=${orderNo}`);
    }

    const created = await createPendingPayment(
      serviceRole,
      order.id,
      order.order_no,
      order.total_amount,
    );
    // insert 失敗（DB 暫時性故障）→ 停在系統忙碌頁，不 redirect。
    if (created === null) {
      return <SystemBusyNotice />;
    }
    merchantTradeNo = created;
  }

  const items = orderItems.map((item) => ({
    quantity: item.quantity,
    // 快照優先（下單當下名稱）；join 現值僅供 null 窗口 fallback
    productName: item.product_name_snapshot ?? item.product.name,
  }));

  const params = buildAioParams(
    order,
    items,
    merchantTradeNo,
    serverEnv.NEXT_PUBLIC_SITE_URL,
  );

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="font-head text-2xl text-ink mb-2">正在轉導至付款頁</h1>
        <p className="text-sm text-ash mb-8">
          請稍候，系統正在為您導向 ECPay 付款頁面...
        </p>

        <form
          id="ecpay-form"
          action={serverEnv.ECPAY_PAYMENT_URL}
          method="POST"
        >
          {Object.entries(params).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <button
            type="submit"
            className="inline-block rounded-[2px] border border-primary px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            若未自動轉導，請點此繼續
          </button>
        </form>

        <EcpayAutoSubmit formId="ecpay-form" />
      </div>
    </main>
  );
}
