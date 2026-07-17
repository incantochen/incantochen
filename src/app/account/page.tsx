import Link from "next/link"
import { requireUser } from "@/lib/auth/require-user"
import { createClient } from "@/lib/supabase/server"

const shortcutClass =
  "rounded-[2px] border border-primary px-8 py-3 text-center text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground"

export default async function AccountPage() {
  const user = await requireUser()
  const supabase = await createClient()
  const { count, error } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("member_id", user.id)

  // §6／F-017：查詢失敗 ≠ 查無訂單——DB 暫時性故障不可誤顯示「無訂單」而把
  // 「查看訂單」捷徑藏起來。throw 交 account/error.tsx 顯示系統忙碌。
  if (error) throw error

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
