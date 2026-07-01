import { requireUser } from "@/lib/auth/require-user"

export default async function OrdersPage() {
  await requireUser()

  return (
    <div className="rounded-lg border border-border bg-cloud px-6 py-10 text-center text-ash">
      訂單列表建置中
    </div>
  )
}
