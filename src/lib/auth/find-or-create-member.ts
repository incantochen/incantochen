import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeEmail } from "@/lib/auth/normalize-email";

export async function findOrCreateMember(userId: string, email: string) {
  const serviceRole = createServiceRoleClient();

  const { data: existing } = await serviceRole
    .from("member")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (existing) {
    return;
  }

  await serviceRole.from("member").insert({ id: userId, email });
}

// Admin 代客建單用：依 email 查會員，查無則建立 auth user＋member row。
// 跟 checkout/actions.ts 內同款邏輯的差異在於這裡是「已登入 admin」的信任
// 操作，不套用 requiresLogin 帳號枚舉防護——語意不同，故獨立成一支 helper
// 而非直接複用 createOrder() 內那段。
export async function findOrCreateMemberByEmail(
  email: string,
): Promise<{ ok: true; memberId: string } | { ok: false; error: string }> {
  const serviceRole = createServiceRoleClient();

  // §6：查詢失敗 ≠ 查無資料——查詢出錯若被誤判成「查無會員」，會走到
  // createUser 撞 email_exists，把 DB 暫時性故障包裝成錯的錯誤訊息。
  const { data: existingMember, error: lookupError } = await serviceRole
    .from("member")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (lookupError) {
    return { ok: false, error: "查詢會員失敗，請稍後再試" };
  }
  if (existingMember) {
    return { ok: true, memberId: existingMember.id };
  }

  const { data: newAuthData, error: createError } =
    await serviceRole.auth.admin.createUser({ email, email_confirm: true });
  if (createError || !newAuthData.user) {
    // email 已存在（判斷條件與 checkout/actions.ts 的 T71 分類一致）：
    // 兩個 admin 分頁併發送同一個新 email 時，輸家撞 email_exists——勝者
    // 多半已把 member row 建好，重查一次沿用；仍查無代表 auth user 存在
    // 但 member row 缺（孤兒帳號），回明確錯誤而非通用「建立會員失敗」。
    if (
      createError?.code === "email_exists" ||
      createError?.code === "user_already_exists" ||
      createError?.message?.toLowerCase().includes("already")
    ) {
      const { data: racedMember, error: retryError } = await serviceRole
        .from("member")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (!retryError && racedMember) {
        return { ok: true, memberId: racedMember.id };
      }

      // 仍查無 member row：不是併發撞號，是「孤兒 auth user」——這個 email
      // 曾經做過 OTP／magic link 登入（Supabase Auth 建了 auth.users row），
      // 但從未完成過一次結帳（findOrCreateMember 只在 createOrder() 內被呼
      // 叫），member row 從未補上。@supabase/auth-js@2.108.2 的 admin API
      // 沒有依 email 查 auth user 的端點，listUsers() 只支援 page/perPage
      // 分頁——掃第一頁（單頁 1000 人）找出這個 email，找到就補建 member
      // row。容量假設：MVP 階段會員數遠低於 1000，之後真的逼近才需要換更
      // 完整的分頁掃描。
      const { data: userPage, error: listError } =
        await serviceRole.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const matchedUser = listError
        ? undefined
        : userPage.users.find(
            (u) => u.email && normalizeEmail(u.email) === email,
          );
      if (matchedUser) {
        await findOrCreateMember(matchedUser.id, email);
        return { ok: true, memberId: matchedUser.id };
      }

      return {
        ok: false,
        error: "此 email 已有帳號但查無會員資料，請稍後再試",
      };
    }
    return { ok: false, error: "建立會員失敗，請稍後再試" };
  }
  await findOrCreateMember(newAuthData.user.id, email);
  return { ok: true, memberId: newAuthData.user.id };
}
