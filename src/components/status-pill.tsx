// 後台通用狀態徽章：色階由呼叫端傳入（訂單／商品等不同狀態集各自的 Tailwind
// gray 系配色 map），元件本身只負責統一的 pill 外觀。
export function StatusPill({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  )
}
