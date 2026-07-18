"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { findOrCreateMember } from "@/lib/auth/find-or-create-member";
import { mergeGuestCartOnLogin } from "@/lib/cart/merge-guest-cart";
import { normalizeEmail } from "@/lib/auth/normalize-email";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function confirmMagicLink(
  tokenHash: string,
  type: EmailOtpType,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error || !data.user) {
    return { ok: false, error: "連結已失效或過期" };
  }

  // T71 ultra review #3：跟 login/actions.ts、checkout/actions.ts 一致的正規化，
  // 避免這條 magic-link 路徑成為 member.email 大小寫不一致的第三個破口。
  await findOrCreateMember(
    data.user.id,
    data.user.email ? normalizeEmail(data.user.email) : "",
  );

  // T81：magic link 登入成功後併訪客購物車入會員名下。fail-soft 是
  // mergeGuestCartOnLogin 的結構保證（同 login/actions），直接 await。
  await mergeGuestCartOnLogin(data.user.id);

  return { ok: true };
}
