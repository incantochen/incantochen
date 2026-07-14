// T73：success／pay／failed 三頁共用，避免限流提示文案／版型各自複製一份。
export function RateLimitedNotice() {
  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-4">
      <p className="text-sm text-ash">請求太頻繁，請稍後再試</p>
    </main>
  );
}
