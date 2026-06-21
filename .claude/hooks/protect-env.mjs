// Hook 1｜保護 .env／金鑰：硬擋對機密檔的讀寫，以及會碰到機密檔的 bash 指令。
// 對應 CLAUDE.md 第 6 節：不得修改 .env*／金鑰／token。
import { readHookInput, getFilePath, getCommand, block, allow } from './lib.mjs';

const input = readHookInput();
const filePath = getFilePath(input).replace(/\\/g, '/');
const command = getCommand(input);

// .env.example 之類的範本檔（無密鑰，本來就該編輯／commit）不擋
const IS_EXAMPLE = /\.(example|sample|template|dist)$/i;

// 視為機密的檔案樣式
const SECRET_FILE =
  /(^|\/)\.env(\.[\w.-]+)?$|service[-_]?account.*\.json$|(^|\/)secrets?\.[\w.-]+$|\.pem$|\.key$|(^|\/)id_rsa\b/i;

// 1) 檔案類工具（Read/Write/Edit）碰到機密檔
if (filePath && SECRET_FILE.test(filePath) && !IS_EXAMPLE.test(filePath)) {
  block(
    `⛔ 已擋下對機密檔的存取：${filePath}\n` +
    `理由：CLAUDE.md 第 6 節——.env／金鑰／token 一律當唯讀，不得由 Claude 讀寫。\n` +
    `若確實需要，請由你本人在編輯器手動處理。`
  );
}

// 2) Bash 指令讀取／修改機密檔
if (command) {
  const BASH_SECRET =
    /(\.env(\.[\w-]+)?\b)|service[-_]?account.*\.json|\bid_rsa\b|\.pem\b|\.key\b/i;
  const READS_OR_WRITES =
    /\b(cat|less|more|head|tail|cp|mv|rm|echo|printf|tee|nano|vi|vim|code|sed|awk|grep|xxd|base64|curl|wget|scp|sftp)\b/i;
  if (BASH_SECRET.test(command) && (READS_OR_WRITES.test(command) || /[>]/.test(command))) {
    block(
      `⛔ 已擋下可能存取機密檔的指令：\n  ${command}\n` +
      `理由：避免讀取／外洩／修改 .env 或金鑰檔。請由你本人手動處理。`
    );
  }
}

allow();
