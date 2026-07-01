"use server"

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/auth/require-user"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { profileFormSchema } from "@/lib/account/schema"

type ActionResult = { ok: true } | { ok: false; error: string }

export async function updateProfile(name: string): Promise<ActionResult> {
  const user = await requireUser()

  const result = profileFormSchema.safeParse({ name })
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? "姓名格式不正確" }
  }

  const serviceRole = createServiceRoleClient()
  const { error } = await serviceRole
    .from("member")
    .update({ name: result.data.name || null })
    .eq("id", user.id)

  if (error) {
    return { ok: false, error: "更新失敗，請稍後再試" }
  }

  revalidatePath("/account/profile")
  return { ok: true }
}
