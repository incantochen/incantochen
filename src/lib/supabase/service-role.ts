import "server-only"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import { env } from "@/lib/env"
import { serverEnv } from "@/lib/env.server"

export function createServiceRoleClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
  )
}
