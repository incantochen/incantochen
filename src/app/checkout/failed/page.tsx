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

export default async function CheckoutFailedPage({
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
  // session）。限流改到解析擁有權「之後」只對非擁有者施加（見下方 #3）。
  const [orderResult, cookieStore, userResult] = await Promise.all([
    serviceRole
      .from("orders")
      .select("order_no, status, member_id")
      .eq("order_no", orderNo)
      .maybeSingle(),
    cookies(),
    createClient().then((c) => c.auth.getUser()),
  ]);

  const { data: order } = orderResult;

  if (!order) redirect("/");

  // 若付款已成功（webhook 先到），直接帶去成功頁
  if (order.status === "paid") {
    redirect(`/checkout/success?order=${orderNo}`);
  }

  // T73 code-review #3：限流只對非擁有者施加（與 success／pay 頁一致），
  // 避免攻擊者拿 order_no 打爆 per-order 桶把真正擁有者鎖在失敗頁外。
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

  if (!isOwner && !(await checkOrderPageViewRateLimit(ip, orderNo))) {
    return <RateLimitedNotice />;
  }

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 mx-auto">
          <svg
            className="h-8 w-8 text-destructive"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>

        <h1 className="font-head text-2xl text-ink mb-2">付款未完成</h1>
        <p className="text-sm text-ash mb-8">
          付款失敗或已取消，您的訂單仍保留，可重新嘗試
        </p>

        <div className="mb-8 rounded-lg border border-border bg-cloud px-6 py-4">
          <p className="text-[11px] tracking-[0.16em] text-ash uppercase mb-0.5">
            訂單號碼
          </p>
          <p className="font-mono text-base font-medium text-ink">
            {order.order_no}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href={`/checkout/pay?order=${order.order_no}`}
            className="inline-block rounded-[2px] bg-primary px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase hover:bg-primary/90 transition-colors"
          >
            重新付款
          </Link>
          <Link
            href="/"
            className="inline-block rounded-[2px] border border-border px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-ash uppercase hover:border-primary hover:text-primary transition-colors"
          >
            返回首頁
          </Link>
        </div>
      </div>
    </main>
  );
}
