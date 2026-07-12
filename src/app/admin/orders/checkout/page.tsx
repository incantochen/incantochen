import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getCart } from "@/lib/cart/read-cart";
import { AdminCheckoutForm } from "@/components/admin-checkout-form";

export default async function AdminCheckoutPage() {
  await requireAdmin();

  const cart = await getCart();

  if (!cart) {
    redirect("/admin/orders");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">建立訂單</h1>
        <p className="mb-6 text-sm text-gray-500">
          代客建立訂單——商品請先透過前台商品頁加入購物袋，這裡只負責指定客戶並產生付款連結。
        </p>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
          <AdminCheckoutForm />

          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900">訂單摘要</h3>
            <div className="mt-4 flex flex-col gap-3">
              {cart.items.map((item) => (
                <div
                  key={item.id}
                  className="flex justify-between gap-3 text-sm"
                >
                  <div>
                    <div className="text-gray-900">{item.productName}</div>
                    <div className="text-gray-500">
                      {item.selectionsSummary} ・ 數量 × {item.quantity}
                    </div>
                  </div>
                  <div className="shrink-0 text-gray-900">
                    NT$ {item.lineTotal.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
            <hr className="my-3 border-gray-200" />
            <div className="flex justify-between font-medium text-gray-900">
              <span>小計</span>
              <span>NT$ {cart.subtotal.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
