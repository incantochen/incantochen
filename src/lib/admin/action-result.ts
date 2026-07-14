// 後台 Server Action 的共用回傳契約。Server Action 拋出的 Error 在 production
// 會被 Next.js 遮罩成通用 digest 訊息，client 根本看不到內容——所以走結構化回傳
// { ok, error }，client 端 notify 才顯示得出來；成功路徑照舊 revalidate。
// warning：操作本體成功、但附帶的 best-effort 環節（如通知信）失敗時的提示，
// 讓操作者知情而不誤判整個操作失敗（T88：出貨信寄失敗不再靜默）。
export type AdminActionResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

// 表單型 action 的變體：成功回建立/更新對象的 id，失敗可帶欄位級錯誤
// （T12 抽出；products/actions.ts 的 ProductActionResult 形狀相同但另帶
// affectedRows，暫不強行收斂）
export type AdminFormActionResult<TKey extends string = string> =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Partial<Record<TKey, string>>;
    };
