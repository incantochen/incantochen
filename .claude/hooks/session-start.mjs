// Hook 6｜SessionStart：每次開新 session 自動把專案紅線注入 context（stdout 會進入對話）。
import { readHookInput } from './lib.mjs';
readHookInput(); // 消化 stdin

process.stdout.write(
`【專案紅線提醒（每次 session 自動注入）】
1. 伺服器端驗價：金額一律後端依白名單重算，絕不信任前端傳來的價格。
2. 不得讀寫 .env／金鑰／token（hook 會硬擋）。
3. DB schema／migration 變更前先進 plan mode 取得確認（hook 會擋）。
4. 只用穩定版套件；不主動升級；主版本升級先提 Migration Plan。
5. 逐任務進行，做完停下回報、等使用者檢核後再進下一個。
6. 做 UI 前先讀 docs/brand-guide.md、docs/user-flow.md 與對應 wireframe。
詳見 CLAUDE.md。`
);
process.exit(0);
