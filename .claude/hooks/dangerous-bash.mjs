// Hook 5｜危險 bash 指令防護：擋下可能造成不可逆損失的指令。
import { readHookInput, getCommand, block, allow } from './lib.mjs';

const input = readHookInput();
const command = getCommand(input);
if (!command) allow();

const DANGER = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, why: 'rm -rf 遞迴強制刪除' },
  { re: /\bgit\s+push\b[^\n]*(--force\b|-f\b)/i, why: 'git push --force（覆寫遠端歷史）' },
  { re: /\bgit\s+reset\s+--hard\b/i, why: 'git reset --hard（丟棄未提交變更）' },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, why: 'git clean -f（刪除未追蹤檔）' },
  { re: /\bdrop\s+(table|database|schema)\b/i, why: 'DROP TABLE／DATABASE／SCHEMA（刪資料）' },
  { re: /\btruncate\s+table\b/i, why: 'TRUNCATE（清空資料表）' },
  { re: /supabase\s+db\s+reset\b/i, why: 'supabase db reset（重置整個資料庫）' },
  { re: /\b(chmod|chown)\s+-R\b/i, why: '遞迴變更權限／擁有者' },
  { re: /\bmkfs\b|\bdd\s+if=|>\s*\/dev\/sd/i, why: '磁碟層級危險操作' },
  { re: /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(sh|bash)\b/i, why: '下載後直接執行（pipe to shell）' },
];

for (const d of DANGER) {
  if (d.re.test(command)) {
    block(
      `⛔ 已擋下高風險指令（${d.why}）：\n  ${command}\n` +
      `理由：此類指令可能造成不可逆的資料／歷史損失。\n` +
      `若確有必要，請由你本人在終端機手動執行並自行確認。`
    );
  }
}

allow();
