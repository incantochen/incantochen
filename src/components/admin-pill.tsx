// admin 端狀態 pill 的單一出處（T11 code review 抽出，原本三個 admin 頁面
// 各複製一份 className）。前台另有品牌樣式的 STATUS_PILL_STYLES，刻意分開。
export function AdminPill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}
