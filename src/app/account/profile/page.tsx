import { requireUser } from "@/lib/auth/require-user"
import { createClient } from "@/lib/supabase/server"
import { ProfileForm } from "@/components/profile-form"

export default async function ProfilePage() {
  const user = await requireUser()
  const supabase = await createClient()
  const { data: member, error } = await supabase
    .from("member")
    .select("name")
    .eq("id", user.id)
    .maybeSingle()

  // §6／F-017：查詢失敗 ≠ 查無會員——DB 故障不可靜默把姓名渲染成空字串。
  // throw 交 account/error.tsx 顯示系統忙碌。
  if (error) throw error

  return (
    <div className="max-w-md rounded-lg border border-border bg-white p-6">
      <ProfileForm email={user.email ?? ""} name={member?.name ?? ""} />
    </div>
  )
}
