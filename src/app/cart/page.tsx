import Link from "next/link"
import { getCart } from "@/lib/cart/read-cart"
import { CartItemRow } from "@/components/cart-item-row"

export default async function CartPage() {
  const cart = await getCart()

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      <div className="text-[11px] tracking-[0.34em] text-secondary-400 uppercase">YOUR BAG</div>
      <h1 className="mt-2 font-heading text-[34px] text-ink">購物袋</h1>

      {!cart ? (
        <div className="mt-10">
          <p className="text-ash">購物袋是空的。</p>
          <Link href="/collections/ring" className="mt-2 inline-block text-primary underline underline-offset-2">
            ← 繼續逛
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 items-start gap-10 lg:grid-cols-[1.6fr_0.9fr]">
          <div>
            {cart.items.map((item) => (
              <CartItemRow key={item.id} item={item} />
            ))}
            <Link href="/collections/ring" className="mt-5 inline-block text-primary underline underline-offset-2">
              ← 繼續逛
            </Link>
          </div>

          <div className="rounded-lg border border-border p-6 lg:sticky lg:top-24">
            <h3 className="font-heading text-xl text-ink">摘要</h3>
            <div className="mt-4 flex justify-between text-sm">
              <span>小計</span>
              <span>NT$ {cart.subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1.5 text-sm">
              <span>運費</span>
              <span className="text-ash">結帳時計算</span>
            </div>
            <hr className="my-3 h-px border-0 bg-secondary-400/50" />
            <div className="flex justify-between font-medium">
              <span>合計</span>
              <span className="text-primary">NT$ {cart.subtotal.toLocaleString()}</span>
            </div>
            <div className="mt-3.5 rounded-lg border border-border bg-cloud px-3.5 py-3 text-sm">
              ⓘ 下單後訂製，交期將於結帳告知。
            </div>
            <Link
              href="/checkout"
              className="mt-3.5 block w-full rounded-[2px] bg-primary px-8 py-4 text-center text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase"
            >
              前往結帳
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
