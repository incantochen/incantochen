import "server-only"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export async function findOrCreateMember(userId: string, email: string) {
  const serviceRole = createServiceRoleClient()

  const { data: existing } = await serviceRole
    .from("member")
    .select("id")
    .eq("id", userId)
    .maybeSingle()

  if (existing) {
    return
  }

  await serviceRole.from("member").insert({ id: userId, email })
}
