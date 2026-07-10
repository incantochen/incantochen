import { redirect } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildAioParams } from "@/lib/ecpay/aio-payment";
import { generateMerchantTradeNo } from "@/lib/ecpay/merchant-trade-no";
import { serverEnv } from "@/lib/env.server";
import { EcpayAutoSubmit } from "@/components/ecpay-auto-submit";

// T74：pending payment 超過此時限視為放棄，換發新交易序號（而非無限期復用
// 可能已被 ECPay 判定逾期的舊 trade no）。
const STALE_PAYMENT_MS = 30 * 60 * 1000;

function isPaymentFresh(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < STALE_PAYMENT_MS;
}

async function createPendingPayment(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
  orderNo: string,
  totalAmount: number,
) {
  const merchantTradeNo = generateMerchantTradeNo(orderNo);
  const { error } = await serviceRole.from("payment").insert({
    order_id: orderId,
    merchant_trade_no: merchantTradeNo,
    amount: totalAmount,
    provider: "ecpay",
    status: "pending",
  });
  if (error) {
    redirect("/checkout");
  }

  // 併發防護：沒有 DB 層級的 unique 約束擋「同一張訂單只能有一筆 pending
  // payment」，若兩個並發請求都判定舊 row 已過期、各自 insert 了一筆新的，
  // 這裡把除了剛剛這筆以外、同訂單其他 pending row 都標記 failed，縮小重複
  // pending row 留存的視窗（非完全原子，但足以清掉絕大多數併發殘留）。
  const { data: otherPending } = await serviceRole
    .from("payment")
    .select("id, merchant_trade_no")
    .eq("order_id", orderId)
    .eq("status", "pending");

  const staleIds = (otherPending ?? [])
    .filter((p) => p.merchant_trade_no !== merchantTradeNo)
    .map((p) => p.id);
  if (staleIds.length > 0) {
    await serviceRole
      .from("payment")
      .update({ status: "failed" })
      .in("id", staleIds)
      .eq("status", "pending");
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

  const serviceRole = createServiceRoleClient();

  const { data: order } = await serviceRole
    .from("orders")
    .select("*")
    .eq("order_no", orderNo)
    .maybeSingle();

  if (!order) {
    redirect("/checkout");
  }

  // 已付款 → 直接進成功頁（避免重送 ECPay）
  if (order.status === "paid") {
    redirect(`/checkout/success?order=${orderNo}`);
  }

  if (order.status !== "pending_payment") {
    redirect("/");
  }

  // 冪等：復用現有 pending payment（頁面重整不重建），
  // 付款失敗後 status 變 failed，下次進來才產生新 trade no。
  // 但 pending 超過 STALE_PAYMENT_MS 視為放棄（T74）：舊 row 標記 failed，換發新序號。
  // 兩個查詢互不依賴（都只靠 order.id），平行送出減少這個高延遲敏感頁面
  // 多等一趟 round trip 的時間。
  const [{ data: orderItems }, { data: existingPending }] = await Promise.all([
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

  if (!orderItems || orderItems.length === 0) {
    redirect("/checkout");
  }

  let merchantTradeNo: string;

  if (existingPending && isPaymentFresh(existingPending.created_at)) {
    merchantTradeNo = existingPending.merchant_trade_no;
  } else {
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
        redirect("/checkout");
      }
      if (!markedFailed) {
        // 沒搶到：這筆 payment 已經被 webhook 處理過（很可能剛好轉 paid）。
        // 重新整頁讓最上方的邏輯用最新的 order.status 重新判斷去向。
        redirect(`/checkout/pay?order=${orderNo}`);
      }
    }
    merchantTradeNo = await createPendingPayment(
      serviceRole,
      order.id,
      order.order_no,
      order.total_amount,
    );
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
