import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getClientIp } from "@/lib/get-client-ip";
import { checkOrderPageViewRateLimit } from "@/lib/rate-limit";
import {
  ORDER_ACCESS_COOKIE,
  resolveOrderOwnership,
} from "@/lib/order/order-access-token";
import { RateLimitedNotice } from "../rate-limited-notice";
import { SystemBusyNotice } from "../system-busy-notice";
import { OrderCancelledNotice } from "@/components/order-cancelled-notice";
import { OrderStatusCheck } from "./order-status-check";
import { PurchaseTracker } from "@/components/analytics/purchase-tracker";
import {
  DELIVERY_METHOD_LABELS,
  type DeliveryMethod,
} from "@/lib/order/delivery-method";

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderNo } = await searchParams;

  if (!orderNo) redirect("/");

  const headersList = await headers();
  const ip = getClientIp(headersList);
  const serviceRole = createServiceRoleClient();

  // 三個互不依賴的 I/O 平行送出（Postgres 查訂單／讀 cookie／Supabase Auth
  // session）。限流改到解析擁有權「之後」只對非擁有者施加（見下方 #3），
  // 故不再放進這批平行查詢。
  const [orderResult, cookieStore, userResult] = await Promise.all([
    serviceRole
      .from("orders")
      .select(
        "order_no, status, total_amount, delivery_method, member_id, invoice_no, invoice_status, invoice_meta, member:member_id(email), order_item(product_id, product_name_snapshot, unit_price_snapshot, quantity, product:product_id(name))",
      )
      .eq("order_no", orderNo)
      .maybeSingle(),
    cookies(),
    createClient().then((c) => c.auth.getUser()),
  ]);

  const { data: order, error: orderError } = orderResult;
  // T95（F-008）：查詢失敗 ≠ 查無資料——已付款客人在成功頁遇到 DB 暫時性
  // 故障，不可被 redirect 回首頁（看起來像訂單消失），停在原地請他重整。
  if (orderError) return <SystemBusyNotice />;
  if (!order) redirect("/");

  // T73：非擁有者（cookie 缺席／不符，且未以自己的帳號登入）不顯示 email，
  // 避免 URL 上的 order_no 被枚舉時外洩其他客人的個資。缺席不 redirect——
  // T111 後台代客建單的付款連結在客人裝置上本來就沒有這把 cookie。
  const cookieToken = cookieStore.get(ORDER_ACCESS_COOKIE)?.value;
  const {
    data: { user },
  } = userResult;
  const { ownerBySession, ownerByCookie } = resolveOrderOwnership(
    cookieToken,
    order,
    user,
  );
  const isOwner = ownerBySession || ownerByCookie;

  // T73 code-review #3：限流只對非擁有者施加——擁有者（有效 cookie／登入
  // session）永不被限流，避免 90 秒 poll 迴圈自我限流、或攻擊者拿 order_no
  // 打爆 per-order 桶把真正擁有者鎖在成功頁外。
  if (!isOwner && !(await checkOrderPageViewRateLimit(ip, orderNo))) {
    return <RateLimitedNotice />;
  }

  const memberData = order.member;
  const email = isOwner
    ? Array.isArray(memberData)
      ? memberData[0]?.email
      : memberData?.email
    : undefined;

  // T42：發票號碼＋隨機碼（對獎用）——已開立才顯示；發票在付款後由 webhook
  // 的 after() 非同步開立，客人剛跳轉到成功頁時可能還沒好，晚幾秒重新整理
  // 就會出現（成功頁本身無自動輪詢，屬可接受的最終一致）。僅擁有者可見，
  // 比照 email 的 T73 遮罩原則。
  const invoiceRandomNumber = isOwner
    ? ((order.invoice_meta as { random_number?: string } | null)
        ?.random_number ?? null)
    : null;
  const showInvoice =
    isOwner && order.invoice_status === "issued" && !!order.invoice_no;

  if (order.status === "paid") {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center px-4">
        {/* T60：GA4 purchase（once-only，tracker 內以 localStorage 依 orderNo
            去重）。名稱快照優先、join 現值僅 null 窗口 fallback（同 email 模板）；
            numeric 欄位過 Number()——PostgREST 對 numeric 可能回字串（§6）。 */}
        <PurchaseTracker
          orderNo={order.order_no}
          value={Number(order.total_amount)}
          items={order.order_item.map((item) => {
            const p = item.product;
            const joinedName = Array.isArray(p) ? p[0]?.name : p?.name;
            return {
              item_id: item.product_id,
              item_name: item.product_name_snapshot ?? joinedName ?? "商品",
              price: Number(item.unit_price_snapshot),
              quantity: item.quantity,
            };
          })}
        />
        <div className="max-w-md w-full text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto">
            <svg
              className="h-8 w-8 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <p className="eyebrow mb-3">付款成功</p>
          <h1 className="font-head text-2xl text-ink mb-2">感謝您的訂購</h1>
          <p className="text-sm text-ash mb-8">
            我們將盡快為您精心製作，完成後會主動與您聯繫
          </p>

          <div className="mb-6 rounded-lg border border-border bg-cloud px-6 py-5 text-left space-y-4">
            <div>
              <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-0.5">
                訂單號碼
              </p>
              <p className="font-mono text-base font-medium text-ink">
                {order.order_no}
              </p>
            </div>
            <div>
              <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-0.5">
                付款金額
              </p>
              <p className="text-base font-medium text-ink">
                NT${order.total_amount.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-0.5">
                配送方式
              </p>
              <p className="text-base font-medium text-ink">
                {
                  DELIVERY_METHOD_LABELS[
                    order.delivery_method as DeliveryMethod
                  ]
                }
              </p>
            </div>
            {showInvoice && (
              <div>
                <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-0.5">
                  電子發票
                </p>
                <p className="font-mono text-base font-medium text-ink">
                  {order.invoice_no}
                  {invoiceRandomNumber && (
                    <span className="ml-2 text-sm text-ash">
                      隨機碼 {invoiceRandomNumber}
                    </span>
                  )}
                </p>
              </div>
            )}
            {email && (
              <div>
                <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-0.5">
                  確認信寄送至
                </p>
                <p className="text-base text-ink">{email}</p>
              </div>
            )}
          </div>

          {email && (
            <p className="text-xs text-ash mb-6">
              日後可用此 Email 登入查看訂單狀態
            </p>
          )}

          <Link
            href="/"
            className="inline-block rounded-[2px] border border-primary px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            返回首頁
          </Link>
        </div>
      </main>
    );
  }

  if (order.status === "pending_payment") {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 mx-auto">
            <svg
              className="h-8 w-8 text-amber-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>

          <h1 className="font-head text-2xl text-ink mb-2">確認付款中</h1>
          <p className="text-sm text-ash mb-6">系統正在確認您的付款，請稍候…</p>

          <div className="mb-6 rounded-lg border border-border bg-cloud px-6 py-4">
            <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-0.5">
              訂單號碼
            </p>
            <p className="font-mono text-base font-medium text-ink">
              {order.order_no}
            </p>
          </div>

          <OrderStatusCheck />

          <Link
            href="/"
            className="inline-block rounded-[2px] border border-border px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-ash uppercase hover:border-primary hover:text-primary transition-colors"
          >
            返回首頁
          </Link>
        </div>
      </main>
    );
  }

  // T119：已取消訂單改渲染說明頁（取代靜默轉首頁），與 pay 頁一致。
  if (order.status === "cancelled") {
    return <OrderCancelledNotice />;
  }

  redirect("/");
}
