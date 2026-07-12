import { requireAdmin } from "@/lib/auth/require-admin"
import { AdminNav } from "@/components/admin-nav"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">incantochen 後台管理</h1>
          <span className="text-sm text-gray-500">{admin.email}</span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-[180px_1fr] gap-8">
        <aside className="sticky top-8 self-start">
          <AdminNav />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  )
}
