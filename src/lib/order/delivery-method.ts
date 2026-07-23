import { z } from "zod";

// T137：配送方式（面交／宅配）的型別、label、zod enum 單一出處。比照
// order-status.ts 的集中式常數慣例，避免字面量散落於 schema／元件／顯示層
// 各處手刻後失同步（改值只改這裡，type 收斂讓新增值時各處編譯期報缺）。
// 與 orders.delivery_method 的 CHECK 約束（migration 0024）對齊。
export type DeliveryMethod = "delivery" | "pickup";

export const DELIVERY_METHODS: DeliveryMethod[] = ["delivery", "pickup"];

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  delivery: "宅配（黑貓保價＋本人簽收）",
  pickup: "面交自取",
};

// checkout schema 與其他需驗證配送方式的端共用。default('delivery')：admin
// 代客建單（T111）共用 checkoutFormSchema 但不收配送方式 UI，缺省視同宅配。
export const deliveryMethodSchema = z.enum(["delivery", "pickup"]);
