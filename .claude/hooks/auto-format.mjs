// Hook 3｜寫檔後自動 lint／format。設計為「永不擋住」Claude，純粹順手整理。
import { execSync } from 'node:child_process';
import { readHookInput, getFilePath } from './lib.mjs';

const input = readHookInput();
const filePath = getFilePath(input);
if (!filePath) process.exit(0);

// 只處理原始碼檔
if (!/\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|md)$/i.test(filePath)) process.exit(0);
// 跳過產物與相依
if (/node_modules|\.next[\\/]|dist[\\/]|build[\\/]/.test(filePath)) process.exit(0);

// 失敗一律吞掉，避免中斷流程（exit 0）
try {
  execSync(`pnpm exec prettier --write "${filePath}"`, { stdio: 'ignore' });
} catch {}
try {
  execSync(`pnpm exec eslint --fix "${filePath}"`, { stdio: 'ignore' });
} catch {}

process.exit(0);
