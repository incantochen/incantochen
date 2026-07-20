import "server-only";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PG_UNIQUE_VIOLATION } from "@/lib/supabase/postgres-error-codes";
import {
  invoiceTargetToMeta,
  type InvoiceTargetInput as InvoiceTargetInputType,
} from "@/lib/order/invoice-meta";
import {
  verifyCartPrices,
  PriceVerificationUnavailableError,
  type VerifiedItem,
} from "@/lib/quote/verify-prices";
import { touchCartUpdatedAt } from "@/lib/cart/touch-cart-updated-at";
import {
  transitionOrder,
  OrderTransitionRaceError,
  PaidOrderCancelBlockedError,
} from "@/lib/order/state-machine";
import type { Json } from "@/types/database.types";
import { z } from "zod";

export type CreateOrderFromCartResult =
  | { ok: true; orderNo: string }
  | {
      ok: false;
      error: string;
      priceUpdated?: true;
      // T12：verifyCartPrices 拋出的錯誤全是「購物車內容本身有問題」（商品
      // 已下架、選項已被後台隱藏、必選規格缺選擇……），客人能做的自救動作
      // 都一樣——回購物車移除或調整該項目，故統一標記，供結帳頁顯示明確
      // 的返回連結，不再只是一段無法互動的錯誤文字
      showCartLink?: true;
    };

type ServiceRole = ReturnType<typeof createServiceRoleClient>;

type CartItemInput = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price_snapshot: number;
  config_snapshot: Json;
};

type RecipientInput = {
  recipientName: string;
  recipientPhone: string;
  zipCode: string;
  shippingAddress: string;
};

// T42：發票去向（型別與 jsonb 對映的單一出處在 invoice-meta.ts），結帳時收集、
// 寫進 orders.invoice_meta 供付款成功後開立時讀取。可選——admin 代客建單
// （T111）目前不收發票去向，缺省時 issueInvoiceForOrder 預設走個人（綠界載具）。
export type { InvoiceTargetInput } from "@/lib/order/invoice-meta";

// T76：create_order_with_items 的 p_items 參數在 RPC 那端是未型別化的 jsonb，
// 不像先前直接 .insert() 到 order_item 時能靠生成型別做端到端檢查。這裡在送
// 進 RPC 之前先驗一次形狀，把「欄位改名/漏欄位」這類契約走鐘及早攔下，不必
// 等到 DB 端因型別轉換失敗或（更糟）安靜寫入錯的值才發現。
const orderItemPayloadSchema = z
  .array(
    z.object({
      product_id: z.string().uuid(),
      product_name_snapshot: z.string().min(1),
      quantity: z.number().int().positive(),
      unit_price_snapshot: z.number().nonnegative(),
      config_snapshot: z.custom<Json>(),
    }),
  )
  .min(1);

export function generateOrderNo(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid confusable chars
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars[randomInt(0, chars.length)];
  }
  return `INC-${date}-${suffix}`;
}

export type ResolvePendingOrderResult =
  | { kind: "reuse"; orderNo: string }
  | { kind: "proceed" }
  | { kind: "error"; error: string };

// T75 讓 cart 在下單後、付款前這段期間繼續存在，代表客人可能回到 /cart
// 對同一張還沒結案的購物車重複按「結帳」。
// - cart 沒被再動過、收件資訊也沒變：這是同一份內容的重複送出，直接沿用
//   既有訂單（reuse）。
// - cart 有被動過（加了商品／改了數量）：既有訂單已不代表客人現在要買的
//   東西，不能把人導去付舊金額——把舊單取消（pending_payment→cancelled
//   合法轉換），回 proceed 讓呼叫端用最新內容開新單。
// - 收件資訊變了（姓名／電話／郵遞區號／地址任一不同）：視同「cart 已
//   變更」同樣取消重建——沿用舊單等於把新輸入的收件資訊整段丟掉，admin
//   改地址錯字重送時會靜默寄到舊地址（審查發現，2026-07-12）。
// - 帶 memberId 時（admin 代客建單）額外比對 member：舊單掛在別的會員下
//   （例如 admin 打錯 email 後改正重送）視同「cart 已變更」取消重建——
//   絕不能把掛在錯誤客戶帳上的訂單付款連結原樣沿用。客人流程**不帶**
//   memberId：這個檢查必須在會員解析之前跑——訪客首次建單時 member row 已
//   隨之建立，若先解析會員，重送未變更 cart 會撞上「email 已註冊請登入」
//   而拿不到既有訂單的付款頁——且 cart 由 guest_token cookie 綁定、本來
//   就是本人的。
// 查詢失敗必須擋下而非放行（§6：查詢失敗 ≠ 查無資料）——dedup 防護在 DB
// 不穩時 fail-open 等於雙重下單風險最高的時刻防護自動消失。
export async function resolvePendingOrderForCart(
  serviceRole: ServiceRole,
  cartId: string,
  cartUpdatedAt: string,
  recipient: RecipientInput,
  memberId?: string,
): Promise<ResolvePendingOrderResult> {
  const { data: existingPendingOrder, error: dedupError } = await serviceRole
    .from("orders")
    .select(
      "id, order_no, created_at, member_id, recipient_name, recipient_phone, zip_code, shipping_address",
    )
    .eq("cart_id", cartId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dedupError) {
    return { kind: "error", error: "建立訂單失敗，請稍後再試" };
  }

  if (!existingPendingOrder) {
    return { kind: "proceed" };
  }

  const sameMember =
    memberId === undefined || existingPendingOrder.member_id === memberId;

  const sameRecipient =
    existingPendingOrder.recipient_name === recipient.recipientName &&
    existingPendingOrder.recipient_phone === recipient.recipientPhone &&
    existingPendingOrder.zip_code === recipient.zipCode &&
    existingPendingOrder.shipping_address === recipient.shippingAddress;

  if (
    sameMember &&
    sameRecipient &&
    cartUpdatedAt <= existingPendingOrder.created_at
  ) {
    return { kind: "reuse", orderNo: existingPendingOrder.order_no };
  }

  try {
    await transitionOrder(existingPendingOrder.id, "cancelled", {
      note: !sameMember
        ? "代客建單客戶已更換，舊待付款訂單自動取消（重新建單）"
        : !sameRecipient
          ? "收件資訊已變更，舊待付款訂單自動取消（重新結帳）"
          : "購物車內容已變更，舊待付款訂單自動取消（重新結帳）",
    });
  } catch (e) {
    if (e instanceof PaidOrderCancelBlockedError) {
      // 舊待付款訂單其實已收到款（webhook 側卡單，payment=paid／orders 仍
      // pending_payment），守衛擋下取消。絕不可建新單——否則客人會為同一批
      // 商品付第二次錢（雙重扣款），舊單的錢還卡在已取消狀態。回錯誤請客人
      // 稍候（reconcile 漂移臂隔日會把舊單推進成 paid、補寄確認信）或聯繫客服。
      return {
        kind: "error",
        error: "您有一筆已付款的訂單正在處理中，請稍候再試或聯繫客服",
      };
    }
    if (e instanceof OrderTransitionRaceError) {
      // 舊單剛好被其他流程動過（多半是 webhook 轉 paid）。同會員且收件資訊
      // 也沒變時才沿用它的單號——呼叫端導頁後該頁會依最新狀態決定去向
      // （已付款則進成功頁）；否則絕不能把（可能地址已過期或掛在別人帳上
      // 的）舊單交出去，回錯誤讓操作者重試。
      if (sameMember && sameRecipient) {
        return { kind: "reuse", orderNo: existingPendingOrder.order_no };
      }
      return { kind: "error", error: "建立訂單失敗，請稍後再試" };
    }
    // 非競態失敗（T110 後含 log 寫入失敗 rollback）擋在結帳咽喉點——必須
    // 留下遙測，否則持續性故障只會反覆呈現成客人看到的「請稍後再試」，
    // ops 無從得知營收正在流失。
    console.error(
      "[resolvePendingOrderForCart] 舊待付款訂單取消失敗",
      { orderId: existingPendingOrder.id },
      e,
    );
    Sentry.captureException(e, {
      extra: { orderId: existingPendingOrder.id },
    });
    return { kind: "error", error: "建立訂單失敗，請稍後再試" };
  }

  return { kind: "proceed" };
}

// 抽自 checkout/actions.ts 的 createOrder()：拿到 memberId 之後、與「這張
// cart 該不該變成一筆訂單」有關的邏輯，跟呼叫端是客人結帳還是 admin 代客
// 建單無關。呼叫端的 redirect() 與否交給自己決定（客人版導去付款頁；
// admin 版顯示付款連結），這裡一律用回傳值溝通結果。
// 注意：pending 訂單 dedup 不在這裡——呼叫端必須先呼叫
// resolvePendingOrderForCart（客人流程要在會員解析之前跑，見該函式註解）；
// 這裡只保留 uq_orders_one_pending_per_cart 撞號的 DB 層兜底。
export async function createOrderFromCart(
  serviceRole: ServiceRole,
  cartId: string,
  cartItems: CartItemInput[],
  memberId: string,
  recipient: RecipientInput,
  invoiceTarget?: InvoiceTargetInputType,
): Promise<CreateOrderFromCartResult> {
  const { recipientName, recipientPhone, zipCode, shippingAddress } = recipient;

  // 伺服器端驗價（T41 安全紅線：絕不信任 cart 快照價）
  let verifiedItems: VerifiedItem[];
  try {
    verifiedItems = await verifyCartPrices(serviceRole, cartItems);
  } catch (e) {
    // DB 暫時性故障（可重試）不是「購物車內容有問題」——不帶 showCartLink，
    // 免得正常購物車遇到 DB 抖動被叫去「前往購物車調整」（沒東西可改）。
    if (e instanceof PriceVerificationUnavailableError) {
      return { ok: false, error: e.message };
    }
    const msg =
      e instanceof Error ? e.message : "商品資訊有誤，請重新確認後再試";
    return { ok: false, error: msg, showCartLink: true };
  }

  // 若任何品項金額有變動：更新 cart 快照、提示使用者確認新金額後再送出
  // （對齊 user-flow.md R/S/Q loop：不靜默建單，讓客人看到新金額再確認）
  const changedItems = verifiedItems.filter((item) => item.priceChanged);
  if (changedItems.length > 0) {
    await Promise.all(
      changedItems.map((item) =>
        serviceRole
          .from("cart_item")
          .update({
            unit_price_snapshot: item.verifiedUnitPrice,
            config_snapshot: item.configSnapshot,
          })
          .eq("id", item.cartItemId),
      ),
    );
    await touchCartUpdatedAt(serviceRole, cartId);
    revalidatePath("/cart");
    revalidatePath("/checkout");
    // 這支函式同時服務客人 checkout 與 admin 代客建單（T111）兩條路徑，
    // 後者的購物袋摘要畫在 /admin/orders/checkout，不 revalidate 這條路徑
    // 的話 admin 端會繼續看到變價前的小計。
    revalidatePath("/admin/orders/checkout");
    return {
      ok: false,
      error: "商品金額已更新，請確認新金額後再次送出",
      priceUpdated: true,
    };
  }

  // 依驗證後價格計算金額
  const subtotal = verifiedItems.reduce(
    (sum, item) => sum + item.verifiedUnitPrice * item.quantity,
    0,
  );
  const shippingFee = 0; // T48 暫緩
  const totalAmount = subtotal + shippingFee;

  // Insert order + order_items in one transaction (retry once on order_no
  // collision). T76：改用 RPC，order_item insert 失敗會讓整個 function 連
  // orders 一起 rollback，不再留孤兒訂單。
  // T113：parse 目前不可觸發——上游 verifyCartPrices 已嚴格驗過形狀，走到這裡
  // 形狀必定吻合。包 try/catch 純屬防呆：未來上游邏輯改動導致契約漂移（欄位
  // 改名／漏欄位／型別走鐘）時，把未包裝的 ZodError 攔在這裡，轉成與函式其餘
  // 部分一致的結構化 {ok:false,error}，客人／admin 看到明確訊息而非 Next.js
  // 遮罩的通用例外。契約漂移是靜默破口，必須留遙測（§0.2）讓 ops 知道
  // verifiedItems→RPC payload 形狀失同步，而非只反覆呈現成客人的「請稍後再試」。
  let itemsPayload: z.infer<typeof orderItemPayloadSchema>;
  try {
    itemsPayload = orderItemPayloadSchema.parse(
      verifiedItems.map((item) => ({
        product_id: item.productId,
        product_name_snapshot: item.productName,
        quantity: item.quantity,
        unit_price_snapshot: item.verifiedUnitPrice,
        config_snapshot: item.configSnapshot,
      })),
    );
  } catch (e) {
    console.error(
      "[createOrderFromCart] order_item payload 形狀驗證失敗（契約漂移）",
      { cartId, memberId },
      e,
    );
    Sentry.captureException(e, { extra: { cartId, memberId } });
    return { ok: false, error: "訂單資料格式錯誤，請稍後再試" };
  }
  const consentAt = new Date().toISOString();

  async function callCreateOrderRpc(no: string) {
    return serviceRole.rpc("create_order_with_items", {
      p_member_id: memberId,
      p_order_no: no,
      p_cart_id: cartId,
      p_recipient_name: recipientName,
      p_recipient_phone: recipientPhone,
      p_zip_code: zipCode,
      p_shipping_address: shippingAddress,
      p_subtotal: subtotal,
      p_shipping_fee: shippingFee,
      p_total_amount: totalAmount,
      p_custom_consent: true,
      p_consent_at: consentAt,
      p_items: itemsPayload,
    });
  }

  // 兩次嘗試（首發＋order_no 撞號重試）共用同一套錯誤分類，避免像先前那樣
  // 重試那次的分支把「購物車已過期」（23503）跟其他失敗混在一起，讓客人看到
  // 不對應實情的通用錯誤訊息。
  // 23505 有兩個可能來源，靠 constraint 名稱區分：
  // - orders_order_no_key：order_no 撞號 → 換號重試一次
  // - uq_orders_one_pending_per_cart（0011）：併發雙送出搶輸 —— 另一個請求
  //   剛建好同一張 cart 的 pending 訂單，重查後沿用它的單號（check-then-act
  //   dedup 的 DB 兜底，防雙重下單）。重查帶 member_id 過濾：客人流程雙送出
  //   必為同一會員、無影響；admin 兩個分頁用不同 email 併發時查不到（贏家
  //   掛在別的會員下）→ 回通用失敗讓操作者重送，重送會走
  //   resolvePendingOrderForCart 的取消重建路徑，不會把別人的單交出去。
  const isPendingCartCollision = (err: { message?: string } | null) =>
    err?.message?.includes("uq_orders_one_pending_per_cart") ?? false;

  let orderNo = generateOrderNo();
  let { data: order, error: orderError } = await callCreateOrderRpc(orderNo);

  if (
    !order &&
    orderError?.code === PG_UNIQUE_VIOLATION &&
    !isPendingCartCollision(orderError)
  ) {
    orderNo = generateOrderNo();
    ({ data: order, error: orderError } = await callCreateOrderRpc(orderNo));
  }

  if (!order) {
    if (
      orderError?.code === PG_UNIQUE_VIOLATION &&
      isPendingCartCollision(orderError)
    ) {
      const { data: racedOrder, error: racedOrderError } = await serviceRole
        .from("orders")
        .select("order_no")
        .eq("cart_id", cartId)
        .eq("status", "pending_payment")
        .eq("member_id", memberId)
        .maybeSingle();
      if (racedOrderError) {
        return { ok: false, error: "建立訂單失敗，請稍後再試" };
      }
      if (racedOrder) {
        return { ok: true, orderNo: racedOrder.order_no };
      }
      return { ok: false, error: "建立訂單失敗，請稍後再試" };
    }
    if (orderError?.code === "23503") {
      // orders.cart_id FK 違反：cart 在讀取後、RPC 寫入前被刪除（例如剛好被
      // T78 訪客車過期清理排程掃到）。重試沒有意義（cart 已不存在），請客人
      // 重新整理購物車。
      return { ok: false, error: "購物車已過期，請重新整理購物車後再試一次" };
    }
    return { ok: false, error: "建立訂單失敗，請稍後再試" };
  }

  // Cart 保留至付款成功才刪除（T75，見 ensureOrderPaid）——order 已存 cart_id。

  // T42：寫入發票去向，供付款成功後 issueInvoiceForOrder 讀取。best-effort——
  // 這支 UPDATE 不在 create_order_with_items 的交易內（訂單建立已成功，不該
  // 因為這步失敗就讓整筆訂單失敗），寫入失敗時開立會 fallback 成個人發票。
  // fallback 是稅務可見的錯誤結果（客人要統編卻拿到個人發票），失敗必須
  // 進 Sentry（§0.2 靜默失敗點規約），不能只留 console。
  if (invoiceTarget) {
    const { error: invoiceMetaError } = await serviceRole
      .from("orders")
      .update({ invoice_meta: invoiceTargetToMeta(invoiceTarget) })
      .eq("id", order.id);
    if (invoiceMetaError) {
      console.error(
        "[createOrderFromCart] invoice_meta 寫入失敗，開立時將 fallback 為個人發票",
        { orderId: order.id, invoiceMetaError },
      );
      Sentry.captureMessage(
        "createOrderFromCart: invoice_meta 寫入失敗（將 fallback 個人發票）",
        {
          level: "error",
          extra: {
            orderId: order.id,
            target: invoiceTarget.target,
            error: invoiceMetaError.message,
          },
        },
      );
    }
  }

  return { ok: true, orderNo };
}
