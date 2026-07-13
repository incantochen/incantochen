// 後台 Server Action 的共用回傳契約。Server Action 拋出的 Error 在 production
// 會被 Next.js 遮罩成通用 digest 訊息，client 根本看不到內容——所以走結構化回傳
// { ok, error }，client 端 notify 才顯示得出來；成功路徑照舊 revalidate。
export type AdminActionResult = { ok: true } | { ok: false; error: string };
