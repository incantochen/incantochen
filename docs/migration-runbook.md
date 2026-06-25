# migration-runbook — 首次 migration 套用 Runbook（v1）

> 文件更新日期：2026-06-24

> 狀態：✅ 首次套用已完成（2026-06-24，commit `c124482`：雲端 13 表＋11 policy、型別已生）。本檔轉為日後 migration 套用的參考。
> 任務：T03 建表＋T46 RLS 的**雲端套用**（`supabase db push` ＋ `gen types`）。
> 依賴：`supabase/migrations/0001_initial_schema.sql`、`0002_enable_rls_and_policies.sql`、`docs/migration-guide.md`、`docs/data-model.md`。
> 範圍：把已撰寫並在本機 Postgres 驗證過的 0001／0002，套用到你的 Supabase 雲端專案（§11.6 已開通）、生成型別、收尾 commit。
> 下游：T05 會員、T43 dev seed、之後所有用到 13 張表的任務。
> 原則：金鑰／DB 密碼由**你**輸入（紅線，Claude 不碰）；正式環境套用前先確認備份（T34）。

---

## ⚙️ 給 Claude Code 的執行指示（自動 vs 必停）

> 一句話貼給 Claude Code：**「依 `docs/migration-runbook.md` 執行；跑到 `link`／`db push` 前停下，等我輸入密碼與放行。」**

| 階段 | 動作 | 由誰 |
|---|---|---|
| 步驟 0–3 | 裝 CLI、`init`、確認檔案、本機 `start`＋`db reset` 彩排 | 🤖 Claude Code 可自動連續跑 |
| **閘 1：金鑰／DB 密碼** | `link`／`db push` 互動式要密碼 | 🧑 **你**在終端機親手輸入（或放環境變數）。**不貼對話、不寫進 repo、不交給 Claude 代填** |
| **閘 2：放行 migration** | 建立 `.claude/.allow-migration` | 🧑 **你**親手建立。**不可由 Claude Code 自行 `touch` 繞過**——這是你設的真人放行閘 |
| **閘 3：`db push` 綠燈** | 套用 schema 到雲端 | 🧑 先給 plan、**你確認**才 push（CLAUDE.md §6／§7：migration 一律先 plan mode） |
| 步驟 5 | push 成功後 `gen types`、`lint`、`commit` | 🤖 Claude Code 可自動 |

**硬規則（Claude Code 不得違反）：**
- 不得把 DB 密碼／金鑰寫進 repo、`.env*` 或貼進對話（`.env*` 已被 `protect-env` 硬擋）。
- 不得自行建立 `.allow-migration` 或以任何方式繞過 `protect-migration`。
- 不得對**雲端**執行 `supabase db reset`（僅限本機）。
- 到三道閘任一處：**停下、回報、等指示**，不要自作主張往下。

⚠️ **`completion-check` hook 注意**：收工時 hook 會自動跑 `pnpm lint + pnpm test`，但**測試框架要 T51 才建，現在沒有 `test` script**，可能讓 hook 卡住或報錯。若卡在這裡屬已知情況，把錯誤貼回即可（非 migration 本身的問題）。

---

## 0. 圖例與約定

- ✅ 已完成 · ⬜ 待你執行 · ⚠️ 風險／注意 · 🔁 完成後回填 · ⏭️ 下一步。
- 指令一律 `pnpm supabase ...`（對齊 `CLAUDE.md` §4，勿混用全域 supabase）。
- 開發機為 Windows：建立／刪除 `.allow-migration` 的寫法見 §3 步驟 4。

---

## 1. 現況（執行前先對齊）

| 項目 | 狀態 |
|---|---|
| `0001`／`0002` SQL | ✅ 已撰寫，並在真 Postgres 套用＋功能測試通過（13 表／11 policy／帳務禁刪／會員隔離） |
| 對你的 Supabase 專案套用 | ⬜ 尚未（＝雲端還沒建表、型別還沒生） |
| Supabase CLI | ⚠️ 尚未安裝（見 §3 步驟 0） |
| T34 自動備份 | ⚠️ 尚未設（M5）；本次目標是**空的 dev 專案**，無資料可損失 → 風險低 |

> ⚠️ 這份 runbook 的指令需在**你自己的終端機**（或交給 Claude Code）執行；金鑰與 DB 密碼由你輸入。

---

## 2. Pre-flight（三項確認，缺一勿往下）

1. **目標專案正確且為空**：要 push 的是 §11.6 已開通的那個 Supabase 專案，且 Table Editor 目前沒有業務表（首次建表，零資料風險）。
2. **備份紅線知悉**：本次空 dev 專案可略；但此專案**轉正式收單前，務必先補 T34 自動備份**（`migration-guide` 紅線：正式環境套用前先確認備份可用）。
3. **hook 放行準備**：`protect-migration` 會擋 schema 變更，需臨時建 `.claude/.allow-migration`（步驟 4），用完即刪。

---

## 3. 套用步驟（依序執行）

```bash
# 0) 安裝 Supabase CLI（devDependency，版本隨 lockfile）
pnpm add -D supabase

# 1) 若尚未初始化（沒有 supabase/config.toml 時才需要；不會覆蓋既有 migrations）
pnpm supabase init

# 2) 確認 migration 檔就位
ls supabase/migrations/
#   應有 0001_initial_schema.sql、0002_enable_rls_and_policies.sql

# 3) 本機彩排（最貼近正式：用真的 auth schema / roles / auth.uid() 依序套 0001→0002）
pnpm supabase start
pnpm supabase db reset      # ⚠️ 僅限本機；勿對雲端用 db reset
```

⬜ **步驟 4 — 連結雲端並套用**（DB 密碼由你輸入，Claude 不經手）：

```bash
# 連結到你的雲端專案（project-ref 在 Dashboard → Project Settings）
pnpm supabase link --project-ref <你的-project-ref>

# 放行 migration hook → 套用 → 移除放行檔
#   PowerShell： New-Item .claude\.allow-migration -Force
#   Git Bash：   touch .claude/.allow-migration
pnpm supabase db push
#   PowerShell： Remove-Item .claude\.allow-migration
#   Git Bash：   rm .claude/.allow-migration
```

⬜ **步驟 5 — 生成型別、收尾**：

```bash
pnpm supabase gen types typescript --linked > src/types/database.types.ts
pnpm lint
git add supabase/migrations src/types/database.types.ts
git commit -m "feat(db): apply initial schema + RLS (T03, T46)"
```

> 註：`.claude/.allow-migration` 已在 `.gitignore`，不會被 commit。

---

## 4. 套用後驗收（Supabase Dashboard）

| 檢查點 | 預期 |
|---|---|
| Table Editor | 13 張表全部出現（product…notification） |
| 每張表 RLS | **Enabled** |
| Policies | 共 **11** 條（5 公開讀＋6 本人讀） |
| 帳務表權限 | orders／payment／order_item／order_status_log 無 anon／authenticated 的 DELETE |
| `src/types/database.types.ts` | 含 13 張表型別 |

---

## 5. Troubleshooting（卡住就照這裡，仍不行把整段錯誤貼回來）

- **migration 版本格式抱怨**：CLI 可能期望 `<timestamp>_name.sql`；若 push 不認 `0001_` 序號前綴，依 `migration-guide` 改用時間戳命名或 `supabase migration repair`，並把錯誤貼回。
- **`auth.uid()` / 角色相關錯誤**：正式 Supabase 原生有 `anon`／`authenticated`／`service_role`／`auth.uid()`（本機彩排是用替身），雲端通常更順；若報缺，多半是連到了非 Supabase 的 DB。
- **`db push` 中途失敗**：migration 在交易內套用，失敗會回滾；修正後重跑即可（**已套用的 migration 不可改、只加新支**——若 0001 已套、要改就新增 0003）。
- **權限／密碼**：`db push` 要 DB 密碼，由你輸入；勿把密碼貼給 Claude、勿寫進 repo。
- **收工 hook 卡住**：`completion-check` 會跑 `pnpm test`，但測試框架 T51 才建——目前無 `test` script，可能報錯卡住；屬已知，與 migration 無關，貼錯誤回來即可。

---

## 6. 待辦／提醒

- ⚠️ **T34 備份**：此 dev 專案轉正式前必補（`migration-guide` 紅線）。
- 🔁 **同步**：`db push` ＋ `gen types` 實際成功後 →
  - `MVP開發任務清單.xlsx`：T03／T46 狀態由「未開始」改為「完成」（在那之前為「進行中：SQL 已驗證、待雲端套用」）。
  - `memory.md` §2／§9、`CLAUDE.md` 頂部狀態：把「已產出並驗證」更新為「已套用至雲端＋型別已生」。
- ⏭️ **下一步**：dev seed（T43）→ M1 戒指可配置並付款。

---

> 變動：v1（2026-06）新建，對應 0001／0002 首次套用；含「給 Claude Code 的執行指示」（自動 vs 必停三閘）與 `completion-check` 注意事項。
