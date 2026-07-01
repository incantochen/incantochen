import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export async function requireUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()

  if (!data.user) {
    const pathname = (await headers()).get("x-pathname")
    redirect(pathname ? `/login?redirect=${encodeURIComponent(pathname)}` : "/login")
  }

  return data.user
}
