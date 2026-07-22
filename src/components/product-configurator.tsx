"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addToCart } from "@/app/products/[slug]/actions";
import { trackAddToCart } from "@/lib/analytics/gtag";

export type ConfiguratorOption = {
  id: string;
  name: string;
  values: {
    id: string;
    label: string;
    isDefault: boolean;
    priceDelta: number;
  }[];
};

function defaultSelection(options: ConfiguratorOption[]) {
  const initial: Record<string, string> = {};
  for (const option of options) {
    const defaultValue =
      option.values.find((value) => value.isDefault) ?? option.values[0];
    if (defaultValue) {
      initial[option.id] = defaultValue.id;
    }
  }
  return initial;
}

export function ProductConfigurator({
  productId,
  productName,
  basePrice,
  options,
  unavailable = false,
}: {
  productId: string;
  productName: string;
  basePrice: number;
  options: ConfiguratorOption[];
  // T117：此商品有必選選項因後台隱藏（類別或最後一個顯示值）而無法完成配置
  // ——停用加入購物袋、改顯示「暫停販售」，別讓客人白配置一輪到結帳才被擋。
  unavailable?: boolean;
}) {
  const [selected, setSelected] = useState(() => defaultSelection(options));
  const [quantity, setQuantity] = useState(1);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const router = useRouter();

  function handleAddToCart() {
    setFeedback(null);
    startTransition(async () => {
      const result = await addToCart({
        productId,
        productOptionValueIds: Object.values(selected),
        quantity,
      });
      setFeedback(
        result.ok
          ? { type: "success", message: "已加入購物袋" }
          : { type: "error", message: result.error },
      );
      if (result.ok) {
        // T60：GA4 add_to_cart。server action 不回 payload，事件由 client
        // 狀態組成——僅供漏斗分析，金額真相仍在伺服器端驗價（§6 紅線不變）。
        trackAddToCart({
          value: unitPrice * quantity,
          items: [
            {
              item_id: productId,
              item_name: productName,
              price: unitPrice,
              quantity,
            },
          ],
        });
        router.refresh(); // re-render server components to update header cart badge
      }
    });
  }

  const selectedValues = options.map((option) => {
    const value = option.values.find((v) => v.id === selected[option.id]);
    return { option, value };
  });
  const unitPrice =
    basePrice +
    selectedValues.reduce(
      (sum, { value }) => sum + (value?.priceDelta ?? 0),
      0,
    );
  const lineTotal = unitPrice * quantity;

  return (
    <div>
      <div className="flex items-baseline gap-3">
        <div className="text-3xl font-medium text-primary">
          NT$ {unitPrice.toLocaleString()}
        </div>
        <span className="text-sm text-ash">
          底價 NT$ {basePrice.toLocaleString()} 起
        </span>
      </div>
      <button
        type="button"
        onClick={() => setShowBreakdown((v) => !v)}
        className="mt-1 text-sm text-primary underline underline-offset-2"
      >
        加價明細 {showBreakdown ? "▴" : "▾"}
      </button>
      {showBreakdown && (
        <div className="mt-2 rounded-lg border border-border px-3.5 py-3 text-sm">
          <div className="flex justify-between py-0.5">
            <span>底價</span>
            <span>NT$ {basePrice.toLocaleString()}</span>
          </div>
          {selectedValues.map(({ option, value }) => (
            <div key={option.id} className="flex justify-between py-0.5">
              <span>
                {option.name}：{value?.label}
              </span>
              <span>
                {value?.priceDelta
                  ? `+ NT$ ${value.priceDelta.toLocaleString()}`
                  : "—"}
              </span>
            </div>
          ))}
          <div className="flex justify-between py-0.5">
            <span>數量 × {quantity}</span>
            <span>—</span>
          </div>
          <hr className="my-2 h-px border-0 bg-secondary-400/50" />
          <div className="flex justify-between font-medium">
            <span>小計</span>
            <span>NT$ {lineTotal.toLocaleString()}</span>
          </div>
        </div>
      )}

      <hr className="my-6 h-px border-0 bg-secondary-400/50" />

      {options.map((option, index) => (
        <div key={option.id} className="py-4">
          <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
            {String(index + 1).padStart(1, "0")}. {option.name}
          </label>
          <div className="mt-2 flex flex-wrap gap-2.5">
            {option.values.map((value) => {
              const isSelected = selected[option.id] === value.id;
              return (
                <button
                  key={value.id}
                  type="button"
                  onClick={() =>
                    setSelected((prev) => ({ ...prev, [option.id]: value.id }))
                  }
                  className={
                    isSelected
                      ? "inline-flex items-center gap-2 rounded-lg border border-primary px-3.5 py-2 text-sm ring-2 ring-secondary-400"
                      : "inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm hover:border-ash"
                  }
                >
                  {value.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="py-4">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
          數量
        </label>
        <div className="mt-2 inline-flex items-center overflow-hidden rounded-lg border border-border">
          <button
            type="button"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="flex h-10 w-10 items-center justify-center text-lg text-primary disabled:opacity-40"
          >
            −
          </button>
          <span className="w-12 text-center text-sm">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => q + 1)}
            className="flex h-10 w-10 items-center justify-center text-lg text-primary"
          >
            +
          </button>
        </div>
      </div>

      {unavailable ? (
        <>
          <button
            type="button"
            disabled
            className="mt-5 w-full cursor-not-allowed rounded-[2px] bg-primary px-8 py-4 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase opacity-50"
          >
            暫停販售
          </button>
          <p className="mt-2 text-sm text-ash">
            此商品目前暫停販售，敬請期待或洽詢客服。
          </p>
        </>
      ) : (
        <>
          <div className="mt-4 rounded-lg border border-border bg-cloud px-3.5 py-3 text-sm">
            ⓘ <strong>下單後為妳訂製</strong>，交期至少 <strong>XX</strong>{" "}
            天，將於結帳再次告知。
          </div>

          <button
            type="button"
            disabled={isPending}
            onClick={handleAddToCart}
            className="mt-5 w-full rounded-[2px] bg-primary px-8 py-4 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase hover:bg-primary-700 disabled:opacity-60"
          >
            {isPending ? "處理中…" : "加入購物袋"}
          </button>
          {feedback && (
            <p
              className={
                feedback.type === "success"
                  ? "mt-2 text-sm text-success"
                  : "mt-2 text-sm text-destructive"
              }
            >
              {feedback.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
