"use server"

import type { EmailOtpType } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { findOrCreateMember } from "@/lib/auth/find-or-create-member"

type ActionResult = { ok: true } | { ok: false; error: string }

export async function confirmMagicLink(
  tokenHash: string,
  type: EmailOtpType,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  })

  if (error || !data.user) {
    return { ok: false, error: "連結已失效或過期" }
  }

  await findOrCreateMember(data.user.id, data.user.email ?? "")

  return { ok: true }
}
