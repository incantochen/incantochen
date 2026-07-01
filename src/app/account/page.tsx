import Link from "next/link"
import { requireUser } from "@/lib/auth/require-user"
import { createClient } from "@/lib/supabase/server"

const shortcutClass =
  "rounded-[2px] border border-primary px-8 py-3 text-center text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground"

export default async function AccountPage() {
  const user = await requireUser()
  const supabase = await createClient()
  const { count } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("member_id", user.id)

  const hasOrders = (count ?? 0) > 0

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {hasOrders ? (
        <Link href="/account/orders" className={shortcutClass}>
          查看訂單
        </Link>
      ) : (
        <div className="flex items-center justify-center rounded-[2px] border border-border px-8 py-3 text-center text-[11.5px] font-medium tracking-[0.2em] text-ash uppercase">
          無訂單
        </div>
      )}
      <Link href="/account/profile" className={shortcutClass}>
        個人資料
      </Link>
    </div>
  )
}
