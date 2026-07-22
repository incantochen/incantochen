import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  resolveCartIdentity,
  findCartByIdentity,
} from "@/lib/cart/resolve-cart-identity";

export type CartItemView = {
  id: string;
  productName: string;
  productSlug: string;
  selectionsSummary: string;
  quantity: number;
  unitPriceSnapshot: number;
  lineTotal: number;
};

export async function getCart(): Promise<{
  items: CartItemView[];
  subtotal: number;
} | null> {
  // T81：登入態以 member_id 查車、訪客以 guest_token 查車（resolver 決定身分）。
  const identity = await resolveCartIdentity();
  if (identity.kind === "none") {
    return null;
  }

  const serviceRole = createServiceRoleClient();

  // T95（F-008）：查詢失敗 ≠ 查無資料——DB 暫時性故障若照樣回 null，客人
  // 會看到「購物袋是空的」的誤報。throw 交給 /cart 的 error boundary 顯示
  // 系統忙碌，不假裝購物車不存在。
  const { data: cart, error: cartError } = await findCartByIdentity(
    serviceRole,
    identity,
  );

  if (cartError) {
    throw new Error(`讀取購物車失敗: ${cartError.message}`);
  }

  if (!cart) {
    return null;
  }

  const { data: cartItems, error: cartItemsError } = await serviceRole
    .from("cart_item")
    .select(
      "id, quantity, unit_price_snapshot, config_snapshot, product:product_id ( name, slug )",
    )
    .eq("cart_id", cart.id)
    .order("created_at", { ascending: true });

  if (cartItemsError) {
    throw new Error(`讀取購物車品項失敗: ${cartItemsError.message}`);
  }

  if (!cartItems || cartItems.length === 0) {
    return null;
  }

  const items: CartItemView[] = cartItems.map((item) => {
    const snapshot = item.config_snapshot as {
      selections?: { label: string }[];
    };
    // §6：PostgREST 對 numeric（unit_price_snapshot）可能回字串——先 Number()，
    // 否則 begin_checkout 事件會把 item price 送成字串（顯示層靠 * 隱式轉數字而
    // 遮住此 bug）。
    const unitPrice = Number(item.unit_price_snapshot);
    return {
      id: item.id,
      productName: item.product.name,
      productSlug: item.product.slug,
      selectionsSummary: (snapshot.selections ?? [])
        .map((s) => s.label)
        .join(" · "),
      quantity: item.quantity,
      unitPriceSnapshot: unitPrice,
      lineTotal: unitPrice * item.quantity,
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);

  return { items, subtotal };
}
