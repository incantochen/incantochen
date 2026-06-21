// Hook 4｜完成前檢查：收工前跑 lint 與測試，未過就擋住、要求修正。
// 對應 CLAUDE.md 第 7 節「完成檢核」。
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readHookInput } from './lib.mjs';

const input = readHookInput();

// 防無限迴圈：若本次停止已是因 Stop hook 而續跑，直接放行。
if (input.stop_hook_active) process.exit(0);

// 沒有 package.json（專案還沒建）就不檢查。
if (!existsSync('package.json')) process.exit(0);

let scripts = {};
try {
  scripts = (JSON.parse(readFileSync('package.json', 'utf8')).scripts) || {};
} catch {
  process.exit(0);
}

const problems = [];

if (scripts.lint) {
  try { execSync('pnpm lint', { stdio: 'pipe' }); }
  catch { problems.push('lint 未通過（pnpm lint）'); }
}

// 只有在有「真的」測試腳本時才跑（避免 create-next-app 預設的佔位腳本）
if (scripts.test && !/no test specified/i.test(scripts.test)) {
  try { execSync('pnpm test', { stdio: 'pipe' }); }
  catch { problems.push('測試未通過（pnpm test）'); }
}

if (problems.length) {
  process.stderr.write(
    `⛔ 收工前檢查未通過：\n- ${problems.join('\n- ')}\n` +
    `請依 CLAUDE.md 第 7 節「完成檢核」修正後再結束本任務。\n`
  );
  process.exit(2); // 擋住結束，訊息回饋給 Claude
}

process.exit(0);
