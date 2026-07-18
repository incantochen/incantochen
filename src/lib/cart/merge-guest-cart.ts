import "server-only";
import * as Sentry from "@sentry/nextjs";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PG_UNIQUE_VIOLATION } from "@/lib/supabase/postgres-error-codes";
import { GUEST_TOKEN_COOKIE } from "@/lib/cart/guest-token";
import { touchCartUpdatedAt } from "@/lib/cart/touch-cart-updated-at";

// T81：登入時把訪客購物車併入會員名下。
//
// 失敗語意＝fail-soft：併車失敗不會遺失資料（guest 車與 cookie 都還在，下次
// 登入會重試、addToCart 的 member 分支也會以 claim fallback 自我修復），所以
// 絕不能讓登入主流程因併車失敗而中止。（findOrCreateMember 維持 fail-closed
// 不變——member row 是 orders FK 的硬前提，性質不同。）
//
// Ownership transition 無 orphan window（invariant）：claim＝單一 atomic
// UPDATE 同時設 member_id、清 guest_token，無中間態；merge 的搬列→刪殼空窗內
// guest 車仍是可達的空車、品項已在會員車。任何失敗分支收斂結果只有兩種——
// 「車仍完整掛在某一身分下」或「空殼待 cleanup」，不存在「有品項但無人可達」。

export async function reportMergeFailure(err: unknown): Promise<void> {
  Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
    tags: { area: "cart-merge", failMode: "fail-soft" },
  });
  // 非 route handler、無平台 auto-flush 兜底：捕捉後即 return，serverless 可能
  // 在事件送出前凍結，主動 flush（§6 禁 fire-and-forget，比照 get-cart-count）。
  await Sentry.flush(2000);
}

type ClaimResult =
  | { status: "claimed"; cartId: string }
  | { status: "none" } // 0 列：查無可 claim 的 guest 車（他方搶先／已被搬走）
  | { status: "conflict" } // 23505：該會員已有一台車（uq_cart_member）
  | { status: "error"; error: unknown };

// 登入版 claim：條件式 UPDATE 把 guest 車轉給會員並**清 guest_token**（讀取鏈
// 已 member-aware、cookie 路徑無必要；保留會讓登出後同瀏覽器以 guest 身分讀到
// 帳號購物車＝隱私外洩）。SET 有改動 WHERE 用到的 member_id／guest_token 欄位，
// 符合 §6 條件式 UPDATE 在 READ COMMITTED 下不會被兩個併發請求同時搶到的規則。
export async function claimGuestCartForMember(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  memberId: string,
  guestToken: string,
): Promise<ClaimResult> {
  const { data, error } = await serviceRole
    .from("cart")
    .update({
      member_id: memberId,
      guest_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("guest_token", guestToken)
    .is("member_id", null)
    .select("id");

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) return { status: "conflict" };
    return { status: "error", error };
  }
  const row = data?.[0];
  if (row) return { status: "claimed", cartId: row.id };
  return { status: "none" };
}

// 結帳即會員（訪客建新會員）用：把當前 cart 掛給新會員但**保留 guest_token**。
// 與登入版 claim 的差異刻意保留 token：①T75 pending 去重以 guest_token 找車，
// 清掉會讓重送結帳誤判「購物車已空」；②訪客下單後、付款前回 /cart 看車時該
// 裝置無 session，仍靠 guest 身分讀車。該裝置本就是本人持 token、保留無隱私
// 疑慮。失敗＝fail-soft skip（不擋建單）。
export async function backfillCartMemberId(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  memberId: string,
  cartId: string,
): Promise<void> {
  const { error } = await serviceRole
    .from("cart")
    .update({ member_id: memberId, updated_at: new Date().toISOString() })
    .eq("id", cartId)
    .is("member_id", null);

  if (error) {
    // 23505（理論上新會員不可能已有車，防禦性）或其他 DB error → fail-soft。
    await reportMergeFailure(error);
  }
}

async function deleteGuestCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(GUEST_TOKEN_COOKIE);
}

export type GuestCartRow = {
  id: string;
  member_id: string | null;
  updated_at: string;
};

export async function selectMemberCartId(
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

// merge：先以 CAS 佔住 guest 車 G，再把品項搬進會員車 M，最後條件式刪 G 的空殼。
export async function mergeCarts(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  memberCartId: string,
  guestCart: GuestCartRow,
): Promise<void> {
  // a0) CAS 鎖：條件式 UPDATE 佔住 G（member_id 仍空＋updated_at 未變才成立）。
  //    搶不到（0 列）＝共用瀏覽器上另一個會員的併發 merge 已搶走、或 G 被
  //    claim／加車動過——沒有這道鎖，兩個「都已有會員車」的登入可各自把同一
  //    台 G 的品項搬進自己車裡，先到先贏、後到靜默搬空（0 列無訊號），品項被
  //    吃進別人帳下。鎖不到一律放棄本次 merge（不搬列、保留 cookie），留給
  //    下次登入／addToCart 重試收斂。
  //    ⚠️ trg_cart_updated_at（0001）在每次 UPDATE 都把 updated_at 蓋成 DB 的
  //    now()——SET 進去的值存不進資料庫，所以佔位值隨便給，改用 RETURNING
  //    （.select）讀回 trigger 實際寫入的值當後續刪殼 guard；比對 JS 端時間戳
  //    永遠 miss（實測：微秒差）。trigger 也保證每次 UPDATE 必改 updated_at
  //    這個 WHERE 欄位，EvalPlanQual 防併發雙搶的前提由它成立。
  const { data: locked, error: lockError } = await serviceRole
    .from("cart")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", guestCart.id)
    .is("member_id", null)
    .eq("updated_at", guestCart.updated_at)
    .select("updated_at");
  if (lockError) {
    await reportMergeFailure(lockError);
    return;
  }
  const lockedAt = locked?.[0]?.updated_at;
  if (!lockedAt) {
    return;
  }

  // a) 搬列（G 已被刪 → 0 列無害）
  const { error: moveError } = await serviceRole
    .from("cart_item")
    .update({ cart_id: memberCartId })
    .eq("cart_id", guestCart.id);
  if (moveError) {
    // 搬列失敗：不刪 cookie、不中止，留給下次登入／addToCart 重試。
    await reportMergeFailure(moveError);
    return;
  }

  // b) 條件式刪空殼。兩道 guard：
  //    - member_id IS NULL：防搬列後空窗被他人 claim（他人車不能刪）。
  //    - updated_at = a0 鎖寫入的值（optimistic，同 T131 精神）：防搬列與
  //      刪殼之間，同瀏覽器另一分頁 guest 併發加車把新品項落進 G（會 touch
  //      G.updated_at）——若無此 guard，DELETE 的 CASCADE 會把剛加的品項一起
  //      帶走（毫秒級資料遺失窗）。
  const { data: deleted, error: deleteError } = await serviceRole
    .from("cart")
    .delete()
    .eq("id", guestCart.id)
    .is("member_id", null)
    .eq("updated_at", lockedAt)
    .select("id");

  // c) touch 會員車（失敗只記錄不中止）
  await touchCartUpdatedAt(serviceRole, memberCartId);

  if (deleteError) {
    // 刪殼 DB error：保留 cookie，空殼留給 cleanup。
    await reportMergeFailure(deleteError);
    return;
  }

  // d) 僅在確實刪到列才刪 cookie。回 0 列＝殼被併發加車復活（updated_at 已變）
  //    或已被他方搶走——此時保留 cookie 讓下次登入／addToCart claim 重新收斂，
  //    避免「cookie 已刪、車上卻還有品項」的孤兒。
  if (deleted && deleted.length > 0) {
    await deleteGuestCookie();
  }
}

async function mergeInner(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  memberId: string,
  guestToken: string,
  attempt: number,
): Promise<void> {
  // 步驟 2：SELECT guest 車 by token（帶 updated_at 供步驟 5b optimistic guard）
  const { data: guestCart, error: guestError } = await serviceRole
    .from("cart")
    .select("id, member_id, updated_at")
    .eq("guest_token", guestToken)
    .maybeSingle();

  if (guestError) {
    await reportMergeFailure(guestError);
    return;
  }
  if (!guestCart) {
    // 查無 guest 車 → no-op（cookie 留給 addToCart 重簽）
    return;
  }
  if (guestCart.member_id === memberId) {
    // 防禦性 no-op：已是自己的車（冪等——本函式會被 OTP／magic link 兩路徑、
    // 雙擊、下次登入重試重複呼叫，連跑必須收斂）。清 cookie。
    await deleteGuestCookie();
    return;
  }
  if (guestCart.member_id !== null) {
    // 他人車（殘留 cookie 換帳號；backfill 變體會產生「有 token 且有 member_id」
    // 的車）：不動該車、刪本地 cookie（否則登出後 guest 路徑可讀他人車）。
    await deleteGuestCookie();
    return;
  }

  // 步驟 3：SELECT 會員車 by member_id
  const memberCart = await selectMemberCartId(serviceRole, memberId);
  if (!memberCart.ok) {
    await reportMergeFailure(memberCart.error);
    return;
  }

  if (memberCart.cartId === null) {
    // 步驟 4：claim
    const claim = await claimGuestCartForMember(
      serviceRole,
      memberId,
      guestToken,
    );
    if (claim.status === "claimed") {
      await deleteGuestCookie();
      return;
    }
    if (claim.status === "none") {
      // 0 列：他方搶先動了這台 guest 車。重走步驟 2 一次（避免無限迴圈）。
      if (attempt === 0) {
        return mergeInner(serviceRole, memberId, guestToken, 1);
      }
      // 重試後仍 0 列 → fail-soft（下次登入／addToCart 自我修復）
      return;
    }
    if (claim.status === "conflict") {
      // 23505：另一裝置搶先建了會員車 → 重查會員車 → 有則改走 merge。
      const raced = await selectMemberCartId(serviceRole, memberId);
      if (!raced.ok) {
        await reportMergeFailure(raced.error);
        return;
      }
      if (raced.cartId !== null) {
        return mergeCarts(serviceRole, raced.cartId, guestCart);
      }
      // conflict 卻查無會員車：不該發生，記 Sentry。
      await reportMergeFailure(
        new Error("claim conflict 但查無會員車 (uq_cart_member 不一致?)"),
      );
      return;
    }
    // claim error
    await reportMergeFailure(claim.error);
    return;
  }

  // 步驟 5：merge（會員車已存在）
  return mergeCarts(serviceRole, memberCart.cartId, guestCart);
}

export async function mergeGuestCartOnLogin(memberId: string): Promise<void> {
  // try 包住**整個**函式體（含 cookies()／createServiceRoleClient()）：fail-soft
  // 是本函式的結構保證，呼叫端（login／auth confirm，未來任何登入路徑）直接
  // await 即可，不需要也不應該各自再包一層 try/catch。
  try {
    const cookieStore = await cookies();
    const guestToken = cookieStore.get(GUEST_TOKEN_COOKIE)?.value;
    if (!guestToken) return; // 步驟 1：無 cookie → no-op

    const serviceRole = createServiceRoleClient();
    await mergeInner(serviceRole, memberId, guestToken, 0);
  } catch (e) {
    // 兜底：任何未預期的 throw 都 fail-soft，不讓登入主流程中止。
    await reportMergeFailure(e);
  }
}
