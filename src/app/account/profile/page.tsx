import { requireUser } from "@/lib/auth/require-user"
import { createClient } from "@/lib/supabase/server"
import { ProfileForm } from "@/components/profile-form"

export default async function ProfilePage() {
  const user = await requireUser()
  const supabase = await createClient()
  const { data: member } = await supabase
    .from("member")
    .select("name")
    .eq("id", user.id)
    .maybeSingle()

  return (
    <div className="max-w-md rounded-lg border border-border bg-white p-6">
      <ProfileForm email={user.email ?? ""} name={member?.name ?? ""} />
    </div>
  )
}
