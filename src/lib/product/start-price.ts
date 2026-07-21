// 「起」價的單一出處：底價＋每組選項「預設值」的加價總和。
//
// 與 product-configurator.tsx 對 PDP 預設組合的算法一致——只用 base_price
// 的話，一旦某必選項的預設值本身帶加價，顯示價格會比 PDP／結帳實際金額低。
// 原本 inline 在 collections/[category]/page.tsx，T59 起 PDP metadata 與
// Product JSON-LD 也要同一數字，抽出共用（§6 識別算法單一出處）。
//
// price_delta／base_price 過 Number()：PostgREST 對 numeric 欄位可能回傳
// 字串（§6），直接相加會變字串串接。

type OptionValueLike = {
  is_default: boolean;
  price_delta: number;
};

type ProductOptionLike = {
  product_option_value: OptionValueLike[];
};

export function computeStartPrice(
  basePrice: number | string,
  productOptions: ProductOptionLike[],
): number {
  const defaultDeltaSum = productOptions.reduce((sum, po) => {
    const def =
      po.product_option_value.find((v) => v.is_default) ??
      po.product_option_value[0];
    return sum + Number(def?.price_delta ?? 0);
  }, 0);
  return Number(basePrice) + defaultDeltaSum;
}
