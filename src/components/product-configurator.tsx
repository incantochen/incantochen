"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addToCart } from "@/app/products/[slug]/actions";
import { trackAddToCart } from "@/lib/analytics/gtag";

export type ConfiguratorValue = {
  id: string
  label: string
  isDefault: boolean
  priceDelta: number
  swatchHex: string | null
}

export type ConfiguratorOption = {
  id: string
  name: string
  // option_type.input_type：swatch（色點）／select（下拉）／stepper（加減器）。
  // 未預期值退回 chip（見 OptionValues 的 default 分支）。
  inputType: string
  values: ConfiguratorValue[]
}

// 依 option_type.input_type 決定選項值的呈現：
//   swatch  → 彩色圓點（basic 漸層：底色 hex + 白色高光 + 內陰影）；
//             任一值缺 swatch_hex 即整組退回 chip（避免同排混排色點與文字）。
//   select  → 原生下拉（選項多時省空間，如戒圍擴充尺碼）。
//   stepper → 加減器，在排序後的值清單前後移動（MVP 無此選項，先保底）。
//   其他/未知 → chip 方塊（維持既有行為，不破版）。
// 送出的仍是 option_value id（Object.values(selected)），計價鏈不變。
function OptionValues({
  option,
  selectedId,
  onSelect,
}: {
  option: ConfiguratorOption
  selectedId: string | undefined
  onSelect: (valueId: string) => void
}) {
  const allHaveSwatch =
    option.values.length > 0 &&
    option.values.every((value) => !!value.swatchHex)

  if (option.inputType === "swatch" && allHaveSwatch) {
    return (
      <div className="mt-2 flex flex-wrap gap-4" role="radiogroup" aria-label={option.name}>
        {option.values.map((value) => {
          const isSelected = selectedId === value.id
          return (
            <button
              key={value.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(value.id)}
              className="flex w-16 flex-col items-center gap-1.5 text-center"
            >
              <span
                style={{
                  backgroundColor: value.swatchHex ?? undefined,
                  backgroundImage:
                    "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.5), rgba(255,255,255,0) 45%)",
                }}
                className={
                  isSelected
                    ? "size-9 rounded-full border border-primary shadow-[inset_0_-3px_6px_rgba(0,0,0,0.18)] ring-2 ring-secondary-400 ring-offset-2 ring-offset-background"
                    : "size-9 rounded-full border border-black/10 shadow-[inset_0_-3px_6px_rgba(0,0,0,0.18)] ring-offset-2 ring-offset-background hover:ring-2 hover:ring-border"
                }
              />
              <span className="text-xs leading-tight text-ink">{value.label}</span>
            </button>
          )
        })}
      </div>
    )
  }

  if (option.inputType === "select") {
    return (
      <div className="relative mt-2 max-w-xs">
        <select
          value={selectedId ?? ""}
          onChange={(event) => onSelect(event.target.value)}
          aria-label={option.name}
          className="w-full appearance-none rounded-[11px] border border-border bg-white px-3.5 py-2.5 pr-10 text-sm text-ink focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none"
        >
          {option.values.map((value) => (
            <option key={value.id} value={value.id}>
              {value.label}
              {value.priceDelta > 0 ? `（+ NT$ ${value.priceDelta.toLocaleString()}）` : ""}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs text-primary"
        >
          ▾
        </span>
      </div>
    )
  }

  if (option.inputType === "stepper") {
    // ⚠️ 已知限制（T120 review 低 2）：stepper 切換時只顯示值名稱，不顯示該值
    // 的 price_delta（swatch/select 會顯示）。計價完全正常——加價仍會算進總價與
    // 加價明細，只是缺「即時價差提示」。MVP 無 stepper 選項故不影響；日後若把
    // 「會加價」的選項設成 stepper，需在下方 current?.label 旁補顯示加價。
    const index = option.values.findIndex((value) => value.id === selectedId)
    const current = index >= 0 ? option.values[index] : undefined
    const prev = index > 0 ? option.values[index - 1] : undefined
    const next = index >= 0 && index < option.values.length - 1 ? option.values[index + 1] : undefined
    return (
      <div className="mt-2 inline-flex items-center overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          disabled={!prev}
          aria-label="上一個"
          onClick={() => prev && onSelect(prev.id)}
          className="flex h-10 w-10 items-center justify-center text-lg text-primary disabled:opacity-40"
        >
          −
        </button>
        <span className="min-w-[8rem] px-2 text-center text-sm text-ink">
          {current?.label ?? "—"}
        </span>
        <button
          type="button"
          disabled={!next}
          aria-label="下一個"
          onClick={() => next && onSelect(next.id)}
          className="flex h-10 w-10 items-center justify-center text-lg text-primary disabled:opacity-40"
        >
          +
        </button>
      </div>
    )
  }

  // default／swatch 缺色碼：維持 chip 方塊按鈕
  return (
    <div className="mt-2 flex flex-wrap gap-2.5">
      {option.values.map((value) => {
        const isSelected = selectedId === value.id
        return (
          <button
            key={value.id}
            type="button"
            onClick={() => onSelect(value.id)}
            className={
              isSelected
                ? "inline-flex items-center gap-2 rounded-lg border border-primary px-3.5 py-2 text-sm ring-2 ring-secondary-400"
                : "inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm hover:border-ash"
            }
          >
            {value.label}
          </button>
        )
      })}
    </div>
  )
}

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
          <OptionValues
            option={option}
            selectedId={selected[option.id]}
            onSelect={(valueId) =>
              setSelected((prev) => ({ ...prev, [option.id]: valueId }))
            }
          />
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
