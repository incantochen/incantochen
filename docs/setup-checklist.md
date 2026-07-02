# 專案建置 Checklist — 高端客製化珠寶電商

> 從零建立 Next.js 16 專案，並落地 `CLAUDE.md` 與 hooks。照順序打勾即可。
> 前置需求：Node.js 20+（`node -v` 確認）、已安裝 pnpm（`pnpm -v`）。

---

## A. 建立專案

- [ ] 在要放專案的資料夾執行：
  ```bash
  pnpm create next-app@latest jewelry-shop \
    --ts --tailwind --eslint --app --src-dir --turbopack --import-alias "@/*"
  ```
  （已帶好：TypeScript、Tailwind、ESLint、App Router、`src/`、Turbopack、`@/*`；React Compiler 預設關閉、AGENTS.md 預設保留。）
- [ ] `cd jewelry-shop`
- [ ] 確認版本：`package.json` 應為 Next 16.x、React 19.2.x。

## B. 落地 CLAUDE.md 與 hooks

- [ ] ⚠️ **用我們的 `CLAUDE.md` 覆蓋** create-next-app 自動生成的那份（複製到根目錄，覆蓋）。
- [ ] 保留它生成的 `AGENTS.md`（Next.js 官方給 AI 的提醒，有用，別刪）。
- [ ] 解壓 `claude-hooks-bundle.zip`，把 `.claude/` 放進根目錄（與 `package.json` 同層）。

## C. 設定微調

- [ ] `tsconfig.json` 的 `compilerOptions` 加一行：
  ```json
  "noUncheckedIndexedAccess": true
  ```
- [ ] `.gitignore` 末尾加：
  ```
  .claude/.allow-migration
  .claude/settings.local.json
  ```

## D. 驗證可運行

- [ ] `pnpm install`
- [ ] `pnpm dev` → 開 `http://localhost:3000` 確認首頁正常。
- [ ] `pnpm lint` 可正常執行。

## E. 接上 Claude Code

- [ ] 在此資料夾打開 Claude Code。
- [ ] 輸入 `/hooks`，確認六個 hook 都載入（protect-env、protect-migration、dangerous-bash、auto-format、completion-check、session-start）。
- [ ] 請 Claude Code 核對 `CLAUDE.md` 第 3、4 節與實際結構／指令是否一致，有出入就微調 CLAUDE.md。
- [ ] **安裝 ECPay 官方 skill**（刻意不進版控，`.gitignore` 已排除；環境重建時照裝）：
  ```bash
  git clone https://github.com/ECPay/ECPay-API-Skill .claude/skills/ecpay
  ```
  安裝當下版本 v3.3（2026-06-26）。綠界官方維護、與 API 同步更新，**不要本地修改**（更新會被蓋掉；License All-Rights-Reserved）。本專案特定的 ECPay 踩坑（IPv4 強制、shell 中文編碼、19 碼 trade no）記在 `CLAUDE.md` T24/T25 條目，不依賴此 skill。

## F. 首次 commit

- [ ] `git add -A && git commit -m "chore: scaffold Next.js 16 project with CLAUDE.md and hooks"`

---

## 注意事項

- **目錄是「目標結構」**：CLAUDE.md 第 3 節列的 `src/lib`、`src/components`、`src/proxy.ts`、`supabase/`、`docs/` 現在還不存在，Claude Code 會在做到對應任務時才建，屬正常。
- **還沒有 `test` 腳本**：預設無測試，`completion-check` hook 會自動只跑 lint；等 T51 加上測試框架（如 vitest）後才會跑 test。
- **hook 沒作用？** `auto-format` 需先裝 prettier／eslint 才生效（eslint 已隨專案安裝；prettier 可 `pnpm add -D prettier`）。

## 下一步（建議順序）

1. （M-1）產出 `docs/user-flow.md` → `docs/wireframe/` → `docs/brand-guide.md`，尤其在寫配置器頁（T16）之前。
2. 進 M0：從 T03（依 ER 圖建 13 張表）＋ T46（RLS）開始。
