import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  PG_UNIQUE_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
} from "@/lib/supabase/postgres-error-codes";
import { findOrCreateMember } from "@/lib/auth/find-or-create-member";
import { claimGuestCartForMember } from "@/lib/cart/merge-guest-cart";

// T81：取得（或建立）會員的購物車——把 addToCart member 分支的完整併發敘事收
// 進單一出處，日後 checkout／再購等寫入路徑要建會員車不再各自複製。
//
// 三步：①命中會員車直回；②無且有 guestToken → claim fallback（登入併車失敗
// 的自我修復點）後重查；③仍無 → 先確保 member row 存在（孤兒 auth user 守衛，
// 見下）再 INSERT，撞 uq_cart_member（23505）重查。
export async function getOrCreateMemberCart(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  memberId: string,
  email: string,
  guestToken?: string,
): Promise<{ ok: true; cartId: string } | { ok: false; error: string }> {
  const GENERIC_ERROR = "系統忙碌，請稍後再試";

  // ① 命中會員車即回
  const first = await selectMemberCartId(serviceRole, memberId);
  if (!first.ok) return { ok: false, error: GENERIC_ERROR };
  if (first.cartId) return { ok: true, cartId: first.cartId };

  // ② 無會員車但有 guest cookie → 嘗試把 guest 車 claim 過來（登入時併車若失敗，
  //    這裡補上自我修復）；claim 後不論成功與否都重查一次取穩定結果。
  if (guestToken) {
    const claim = await claimGuestCartForMember(
      serviceRole,
      memberId,
      guestToken,
    );
    if (claim.status === "claimed") {
      return { ok: true, cartId: claim.cartId };
    }
    // conflict（會員車已被他路徑建好）／none／error → 落到重查
    const after = await selectMemberCartId(serviceRole, memberId);
    if (!after.ok) return { ok: false, error: GENERIC_ERROR };
    if (after.cartId) return { ok: true, cartId: after.cartId };
  }

  // ③ 仍無會員車 → 建一台。先確保 member row 存在：session 有效但 member row
  //    缺（孤兒 auth user——email 曾登入建了 auth.users 但從未結帳、member row
  //    從未補上，見 find-or-create-member.ts 註解）時，直接 INSERT cart 會撞
  //    23503（cart_member_id_fkey）。findOrCreateMember 失敗會 throw（fail-closed，
  //    member row 是硬前提），這裡轉成呼叫端的 result 型別。
  try {
    await findOrCreateMember(memberId, email);
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }

  const { data: inserted, error: insertError } = await serviceRole
    .from("cart")
    .insert({ member_id: memberId })
    .select("id")
    .single();

  if (inserted) return { ok: true, cartId: inserted.id };

  if (insertError?.code === PG_UNIQUE_VIOLATION) {
    // uq_cart_member：另一併發路徑剛建了會員車，重查沿用（比照 addToCart
    // guest 分支的 insert-then-23505-retry）。
    const raced = await selectMemberCartId(serviceRole, memberId);
    if (raced.ok && raced.cartId) return { ok: true, cartId: raced.cartId };
    return { ok: false, error: GENERIC_ERROR };
  }

  if (insertError?.code === PG_FOREIGN_KEY_VIOLATION) {
    // member row 仍缺（findOrCreateMember 應已建好，這裡是兜底分類，避免把 FK
    // 違反誤報成一般建立失敗）。
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: false, error: GENERIC_ERROR };
}

async function selectMemberCartId(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  memberId: string,
): Promise<
  { ok: true; cartId: string | null } | { ok: false; error: unknown }
> {
  const { data, error } = await serviceRole
    .from("cart")
    .select("id")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) return { ok: false, error };
  return { ok: true, cartId: data?.id ?? null };
}
