// 共用工具：讀取 hook 的 stdin JSON、取出常用欄位、擋下／放行。
import { readFileSync } from 'node:fs';

export function readHookInput() {
  try {
    const raw = readFileSync(0, 'utf8'); // fd 0 = stdin
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

export function getFilePath(input) {
  const ti = input.tool_input || {};
  return (ti.file_path || ti.path || ti.notebook_path || '').toString();
}

export function getCommand(input) {
  const ti = input.tool_input || {};
  return (ti.command || '').toString();
}

// 擋下工具呼叫：訊息寫到 stderr 並以 exit code 2 回傳，Claude 會收到此訊息。
export function block(msg) {
  process.stderr.write(msg + '\n');
  process.exit(2);
}

// 放行。
export function allow() {
  process.exit(0);
}
