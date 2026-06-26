import { verifyCheckMacValue } from "@/lib/ecpay/check-mac-value"
import { serverEnv } from "@/lib/env.server"

// ECPay 對 OrderResultURL 是瀏覽器 POST，redirect 必須用 303
// 強制瀏覽器以 GET 取得導向目標，否則 307 會把 POST 原樣帶到 page route 上而 405。
export async function POST(request: Request) {
  const formData = await request.formData()
  const params: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    params[key] = String(value)
  }

  const isValid = verifyCheckMacValue(
    params,
    serverEnv.ECPAY_HASH_KEY,
    serverEnv.ECPAY_HASH_IV,
  )

  if (!isValid) {
    return Response.redirect(new URL("/checkout", request.url), 303)
  }

  const merchantTradeNo = params.MerchantTradeNo
  if (!merchantTradeNo) {
    return Response.redirect(new URL("/checkout", request.url), 303)
  }
  const orderNo = `${merchantTradeNo.slice(0, 3)}-${merchantTradeNo.slice(3, 11)}-${merchantTradeNo.slice(11)}`

  if (params.RtnCode === "1") {
    return Response.redirect(
      new URL(`/checkout/success?order=${orderNo}`, request.url),
      303,
    )
  }

  return Response.redirect(
    new URL(`/checkout/pay?order=${orderNo}&error=payment_failed`, request.url),
    303,
  )
}
