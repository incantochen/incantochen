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
// --fix-type 排除 suggestion：prefer-const 這類「基於全檔推斷」的風格修正
// 會在多步驟編輯的中間狀態誤判（宣告先進、賦值後進 → let 被轉成 const，
// 下一步編輯加上賦值後執行期直接炸 Assignment to constant variable）。
// suggestion 類交給 pnpm lint 在檔案完整時檢查即可，這裡只修真錯誤與排版。
try {
  execSync(`pnpm exec eslint --fix --fix-type problem,layout "${filePath}"`, {
    stdio: 'ignore',
  });
} catch {}

process.exit(0);
