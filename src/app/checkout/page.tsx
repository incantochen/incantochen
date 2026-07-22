import { redirect } from "next/navigation";
import { getCart } from "@/lib/cart/read-cart";
import { createClient } from "@/lib/supabase/server";
import { CheckoutForm } from "@/components/checkout-form";
import { BeginCheckoutTracker } from "@/components/analytics/begin-checkout-tracker";

export default async function CheckoutPage() {
  const cart = await getCart();

  if (!cart) {
    redirect("/cart");
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const defaultEmail = data.user?.email ?? "";

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      {/* T60：GA4 begin_checkout。CartItemView 無 product id，item_id 用 slug */}
      <BeginCheckoutTracker
        value={cart.subtotal}
        items={cart.items.map((item) => ({
          item_id: item.productSlug,
          item_name: item.productName,
          price: item.unitPriceSnapshot,
          quantity: item.quantity,
        }))}
      />
      <div className="text-[11px] tracking-[0.34em] text-secondary-400 uppercase">
        CHECKOUT
      </div>
      <h1 className="mt-2 font-heading text-[34px] text-ink">結帳</h1>

      <div className="mt-8 grid grid-cols-1 items-start gap-10 lg:grid-cols-[1.4fr_1fr]">
        <CheckoutForm defaultEmail={defaultEmail} />

        <div className="rounded-lg border border-border p-6 lg:sticky lg:top-24">
          <h3 className="font-heading text-xl text-ink">訂單摘要</h3>
          <div className="mt-4 flex flex-col gap-3">
            {cart.items.map((item) => (
              <div key={item.id} className="flex justify-between gap-3 text-sm">
                <div>
                  <div className="text-ink">{item.productName}</div>
                  <div className="text-ash">
                    {item.selectionsSummary} ・ 數量 × {item.quantity}
                  </div>
                </div>
                <div className="shrink-0 text-primary">
                  NT$ {item.lineTotal.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
          <hr className="my-3 h-px border-0 bg-secondary-400/50" />
          <div className="flex justify-between py-1.5 text-sm">
            <span>運費</span>
            <span className="text-ash">結帳時計算</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>小計</span>
            <span className="text-primary">
              NT$ {cart.subtotal.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
