// T71 ultra review #5：email 正規化規則單一出處（CLAUDE.md §6，T67 教訓——
// 識別碼格式互轉散落各處手刻會失去同步），login/actions.ts、checkout/actions.ts、
// auth/confirm/actions.ts 一律經由這裡正規化再查詢／寫入 member.email。
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
