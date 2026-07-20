// ECPay 對 OrderResultURL 是瀏覽器 POST，redirect 必須用 303
// 強制瀏覽器以 GET 取得導向目標，否則 307 會把 POST 原樣帶到 page route 上而 405。
// ⚠️ CheckMacValue 驗證留給 T26 ReturnURL webhook（server-to-server，才是安全關卡）
// 這裡只做前端 redirect，不做驗章。
import { revalidatePath } from "next/cache";
import { merchantTradeNoToOrderNo } from "@/lib/ecpay/merchant-trade-no";

export async function POST(request: Request) {
  const formData = await request.formData();
  const merchantTradeNo = formData.get("MerchantTradeNo") as string | null;
  const rtnCode = formData.get("RtnCode") as string | null;

  if (!merchantTradeNo) {
    return Response.redirect(new URL("/checkout", request.url), 303);
  }

  const orderNo = merchantTradeNoToOrderNo(merchantTradeNo);
  if (!orderNo) {
    return Response.redirect(new URL("/checkout", request.url), 303);
  }

  if (rtnCode === "1") {
    // T118：付款成功後購物車由 webhook（ensureOrderPaid）在 server-to-server
    // 端清空，該路徑沒有客人請求上下文，無法讓瀏覽器 Router Cache 失效。SiteHeader
    // 的購物袋徽章（getCartCount）在根 layout 內，客人結帳後導覽回站上若不主動
    // 失效根 layout 快取，徽章會續顯示舊數量（實測 /cart 顯示空、徽章仍 1）。
    // 這裡是付款完成後客人回站的伺服器端導頁點：失效根 layout，徽章隨新的
    // 空購物車重新渲染（"layout" 範圍一次涵蓋全站 header）。
    revalidatePath("/", "layout");
    return Response.redirect(
      new URL(`/checkout/success?order=${orderNo}`, request.url),
      303,
    );
  }

  return Response.redirect(
    new URL(`/checkout/failed?order=${orderNo}`, request.url),
    303,
  );
}
