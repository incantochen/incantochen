---
name: dev-next
description: 開發迴圈的實作與結案階段（下一個任務, next task, 開始修, 實作任務, 結案, close out）。從 tasks.csv 依優先級與批次耦合挑出下一個該做的任務（或指定 T##），走 feature branch 實作→測試→PR；merge 後執行結案回寫（tasks.csv／GitHub issues／review-findings.md）。與 dev-review 組成完整 harness loop：審查→裁決→轉任務→實作→驗收→結案→回歸。
---

# dev-next：實作與結案（harness loop 第④⑥段）

本 skill 承接 dev-review 產出的任務，完成「實作→PR」與「merge 後結案」。全迴圈：

```
①dev-review 排程審查 → review-findings.md（自動）
②使用者標「確認」（人工裁決）
③轉任務＋批次耦合分析 → tasks.csv＋issues（半自動）
④/dev-next：挑任務→實作→PR          ← 本 skill
⑤使用者跑 /code-review ultra → merge（人工驗收）
⑥/dev-next close T##：結案回寫        ← 本 skill
   → 下輪 dev-review 回歸驗證修法正確
```

## 使用方式

- `/dev-next`：自動挑下一個任務並開始實作
- `/dev-next T##`：指定任務
- `/dev-next close T##`（或說「結案」）：merge 後回寫

## 模式一：挑任務與實作

### 1. 挑任務（無指定時）

讀 `docs/tasks.csv`，依序過濾：
1. 狀態＝未開始、且依賴欄的任務全部完成
2. 優先級 P0 → P1 → P2；同級依里程碑（M2 先於 M5）
3. **批次耦合**：任務說明含【批次N】者，整批一起做、不可單獨拆出；批次有前置（如 T85 先於批次1）則前置優先
4. 排除標註「Dashboard 操作由使用者本人執行」的任務——列出提醒使用者，不自己做

向使用者回報選了什麼、為什麼（含批次成員），**取得同意後才動工**。

### 2. 實作規範（全部遵循 CLAUDE.md §7）

- 從最新 master 開 feature branch：`feat/t##-簡述` 或 `fix/t##-簡述`
- **涉及 auth／金流／session／migration 一律先進 plan mode**，等確認再動手
- migration：只新增不修改、需 `.claude/.allow-migration`、先 `db push` 再 merge（見 CLAUDE.md）
- 一個任務（或一個批次）一支 commit，Conventional Commits
- 實作中發現任務描述與現況不符（程式已演進）：停下回報，不自行擴大範圍

### 3. 驗收與 PR

- 跑 `pnpm lint`＋`pnpm test`；改到 T85 涵蓋路徑時測試必須全綠
- 有 runtime 行為的修改用 dev server 實際走一次受影響流程（金流用 ECPay sandbox）
- 開 PR：標題含 T##；body 列「修了什麼／怎麼驗證的／關聯 issue（`Closes #NN`）」
- **依 CLAUDE.md §7 評估並建議是否跑 `/code-review ultra`**（反向白名單：非純 docs／樣式／測試→建議跑）
- 回報 PR 連結後停下，等使用者驗收 merge——**不可自行 merge**

## 模式二：結案回寫（merge 後）

確認 PR 已 merge（`gh pr view` 狀態 MERGED）後，一次完成：

1. `git checkout master && git pull`
2. `docs/tasks.csv`：該任務（含批次成員）狀態改「完成」，說明補「✅ 完成（日期）：一句話摘要＋PR 編號」
3. GitHub issues：若 PR 未帶 `Closes #NN` 自動關閉，補 `gh issue close #NN --comment "已於 PR #MM 修復"`
4. `docs/review-findings.md`：對應 F 項狀態改「已修復」附 PR 編號；若修的是 T 任務也更新回歸狀態區
5. 以上為 docs 變更，commit 直接推 master（`docs(tasks): close T## ...`）
6. 回報：已結案清單＋依挑任務規則預告下一個候選任務

## 護欄

- 全程受 `.claude/hooks` 約束（protect-env／protect-migration／dangerous-bash）
- 程式碼一律走 PR，絕不直接 push master（docs 結案 commit 除外）
- 未經使用者同意不動工、不 merge、不改超出任務範圍的程式
- 每次只做一個任務或一個批次——做完停下，等下一次指令
