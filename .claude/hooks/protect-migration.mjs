// Hook 2｜擋未確認的 DB migration／schema 變更。
// 對應 CLAUDE.md 第 6 節：改 schema 前先進 plan mode 取得確認。
// 放行方式（escape hatch）：經你同意後，建立 .claude/.allow-migration 檔即可放行，完成後刪除。
import { existsSync } from 'node:fs';
import { readHookInput, getFilePath, block, allow } from './lib.mjs';

const input = readHookInput();
const filePath = getFilePath(input).replace(/\\/g, '/');

// 命中條件：supabase/migrations/ 下的檔、schema 檔、或 supabase/ 下的 .sql
const IS_DB_SCHEMA =
  /supabase\/migrations\//i.test(filePath) ||
  /(^|\/)schema\.(sql|prisma)$/i.test(filePath) ||
  (/(^|\/)supabase\//i.test(filePath) && /\.sql$/i.test(filePath));

const SENTINEL = '.claude/.allow-migration';

if (filePath && IS_DB_SCHEMA) {
  if (existsSync(SENTINEL)) {
    allow(); // 你已明確放行本次 schema 工作
  }
  block(
    `⛔ 已擋下資料庫 schema／migration 變更：${filePath}\n` +
    `理由：CLAUDE.md 第 6 節——改 schema 前須先進 plan mode 取得我的確認。\n` +
    `請先停下，向我說明變更內容與影響（plan mode）。\n` +
    `經我同意後，由我執行：touch .claude/.allow-migration  放行，完成後刪除該檔。`
  );
}

allow();
