import type { Database } from "@/types/database.types";
import { CATEGORY_LABELS } from "@/lib/product/category-labels";

export type OptionAppliesTo = Database["public"]["Enums"]["option_applies_to"];

// input_type 是 DB check constraint（swatch|select|stepper），非 enum，
// 生成型別只標 string——這裡的 Record key 就是唯一出處
export type OptionInputType = "swatch" | "select" | "stepper";

export const OPTION_INPUT_TYPE_LABELS: Record<OptionInputType, string> = {
  swatch: "色票",
  select: "下拉選單",
  stepper: "加減器",
};

// 由 key 衍生（比照 product-status.ts）：Record 少列一個值會直接編譯錯誤
export const ALL_INPUT_TYPES = Object.keys(
  OPTION_INPUT_TYPE_LABELS,
) as OptionInputType[];

export const APPLIES_TO_LABELS: Record<OptionAppliesTo, string> = {
  all: "全品類",
  ...CATEGORY_LABELS,
};

export const ALL_APPLIES_TO = Object.keys(
  APPLIES_TO_LABELS,
) as OptionAppliesTo[];
