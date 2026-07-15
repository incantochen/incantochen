import "server-only";
import { headers } from "next/headers";

// T121 信任模型：本站部署在 Vercel、無前置 CDN（2026-07-14 拍板上線純
// Vercel、不掛 Cloudflare）。x-vercel-forwarded-for 由 Vercel edge 設定、
// 客戶端無法覆蓋，為首選；x-forwarded-for 取最左值為備援（本機 dev 等
// 無 Vercel header 的環境）。cf-connecting-ip／x-real-ip 已移除——未經
// Cloudflare 時客戶端可自帶並每次輪換，會讓所有以 IP 為維度的限流
//（OTP／購物車寫入／結帳枚舉／訂單頁）形同虛設。日後若把流量掛上
// Cloudflare，須把 cf-connecting-ip 調回首位（並確認 Vercel 端已鎖來源）。
export function getClientIp(
  headersList: Awaited<ReturnType<typeof headers>>,
): string | null {
  const first = (value: string | null) => {
    const ip = value?.split(",")[0]?.trim();
    return ip ? ip : null;
  };

  return (
    first(headersList.get("x-vercel-forwarded-for")) ??
    first(headersList.get("x-forwarded-for"))
  );
}
