import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { PostgrestError } from "@supabase/supabase-js";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";
import { GUEST_TOKEN_COOKIE } from "@/lib/cart/guest-token";

// T81：購物車身分解析的單一出處。讀取鏈（read-cart／get-cart-count／cart
// actions／checkout／admin checkout）都改由這裡決定「這次要查誰的車」。
//
// ⚠️ Identity invariant（硬規則，勿破）：**已登入＝member identity，絕不
// fallback 到 guest token 讀取**——即使該會員還沒有車、即使瀏覽器仍帶著
// guest cookie，一律回 member 身分（查無車就是空車）。guest identity 只在
// 完全無 session 時才成立。
//
// 這條是 mergeGuestCartOnLogin「他人車→刪 cookie」隱私防線的前提：登入併車
// 時，若遇到 guest cookie 指向的車 member_id 屬於別的帳號（殘留 cookie 換帳號），
// 我們刪掉本地 cookie 以免登出後又以 guest 身分讀到別人的車。但只要讀取鏈
// 任何一點在 member 態還會偷讀 token，殘留 cookie 就足以跨帳號讀車、防線失效。
// 所以「登入態一律不看 token」不是效能選擇，是安全不變式。
export type CartIdentity =
  | { kind: "member"; memberId: string }
  | { kind: "guest"; guestToken: string }
  | { kind: "none" };

// cache()：同一請求內 header 的 getCartCount 與頁面本體會各呼叫一次解析，
// React cache 讓 getUser／cookie 讀取在請求內去重。
export const resolveCartIdentity = cache(async (): Promise<CartIdentity> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return { kind: "member", memberId: user.id };
  }

  const cookieStore = await cookies();
  const guestToken = cookieStore.get(GUEST_TOKEN_COOKIE)?.value;
  if (guestToken) {
    return { kind: "guest", guestToken };
  }

  return { kind: "none" };
});

// 依身分查該身分的 cart row。回傳 {data,error} 原樣交呼叫端，各自維持既有
// fail-soft（get-cart-count 回 0）/ fail-closed（read-cart throw）語意——這支
// 不替呼叫端決定錯誤處理，只負責「用對的欄位查對的車」。
//
// 固定選 id＋updated_at（涵蓋所有呼叫端所需，多一欄 updated_at 成本可忽略）：
// 刻意不做成 generic `select(columns: C)`——supabase-js 的 select 字串型別
// parser 對未解析的泛型會爆炸性展開，實測會讓 tsc 記憶體 OOM。用字面量讓
// parser 在具體型別上運作即可。
export type CartIdentityRow = { id: string; updated_at: string };

export async function findCartByIdentity(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  identity: CartIdentity,
): Promise<{ data: CartIdentityRow | null; error: PostgrestError | null }> {
  if (identity.kind === "member") {
    return serviceRole
      .from("cart")
      .select("id, updated_at")
      .eq("member_id", identity.memberId)
      .maybeSingle();
  }
  if (identity.kind === "guest") {
    return serviceRole
      .from("cart")
      .select("id, updated_at")
      .eq("guest_token", identity.guestToken)
      .maybeSingle();
  }
  // none：沒有身分＝沒有車。回成 supabase 風格的空結果，呼叫端不需分辨
  // 「查無身分」與「查無車」——兩者對購物車而言都是「空」。
  return { data: null, error: null };
}
