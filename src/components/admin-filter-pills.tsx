import Link from "next/link"

export type AdminFilterPillItem = {
  key: string
  label: string
  href: string
  active: boolean
}

// 後台列表頁通用的狀態篩選 tabs（訂單／商品列表共用外觀）。
export function AdminFilterPills({ items }: { items: AdminFilterPillItem[] }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={`px-3 py-1.5 rounded text-sm font-medium ${
            item.active
              ? "bg-gray-900 text-white"
              : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}
