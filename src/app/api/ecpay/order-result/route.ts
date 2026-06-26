// ECPay 對 OrderResultURL 是瀏覽器 POST，redirect 必須用 303
// 強制瀏覽器以 GET 取得導向目標，否則 307 會把 POST 原樣帶到 page route 上而 405。
// ⚠️ CheckMacValue 驗證留給 T26 ReturnURL webhook（server-to-server，才是安全關卡）
// 這裡只做前端 redirect，不做驗章。
export async function POST(request: Request) {
  const formData = await request.formData()
  const merchantTradeNo = formData.get("MerchantTradeNo") as string | null
  const rtnCode = formData.get("RtnCode") as string | null

  if (!merchantTradeNo) {
    return Response.redirect(new URL("/checkout", request.url), 303)
  }

  const orderNo = `${merchantTradeNo.slice(0, 3)}-${merchantTradeNo.slice(3, 11)}-${merchantTradeNo.slice(11)}`

  if (rtnCode === "1") {
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
