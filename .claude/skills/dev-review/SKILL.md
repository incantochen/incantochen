---
name: dev-review
description: 軟體開發審查（審查, review, code review, 環境審查, schema 審查, 上線前檢查）。以兩遍式流程系統性審查本專案的程式碼、資料庫 schema、雲端環境設定與開發流程：第一遍開放式對抗性審查發現未知問題，第二遍用缺陷類別清單回歸掃描。產出依嚴重度排序的發現，落地為 tasks.csv 任務與 GitHub issues。範圍參數：code｜schema｜env｜flow｜full（預設 full）。
---

# 軟體開發審查（dev-review）

對 incantochen（jewelry-shop）做系統性審查。收真錢的電商——金流與資料正確性永遠是最高優先。

## 使用方式

- `/dev-review`：full，四個範圍全跑
- `/dev-review code`／`schema`／`env`／`flow`：只跑單一範圍

## 核心設計：兩遍式流程（順序不可顛倒）

**第一遍——開放式對抗性審查（不看清單）**：帶著 `references/adversarial-questions.md` 的通用問題集讀程式。問題集能「產生」清單上沒有的發現；先看清單會造成錨定，注意力退化成逐項比對。

**第二遍——類別清單回歸掃描**：第一遍完成後，才讀對應範圍的 checklist 做系統性補漏與歷史回歸。清單條目是「缺陷類別」，附掛的歷史案例只是校準範例（讓你知道這類問題長什麼樣），不是搜尋目標本身——比對完案例點位就停手＝審查失敗。

| 階段 | 必讀檔案 | 用途 |
|---|---|---|
| 第一遍（所有範圍） | `references/adversarial-questions.md` | 通用對抗性問題集 |
| 第二遍 code | `references/code-checklist.md` | 缺陷類別清單＋閱讀地圖＋校準範例 |
| 第二遍 schema | `references/schema-checklist.md` | schema 缺陷類別清單 |
| 第二遍 env | `references/env-audit.md` | 唯讀指令全集、SQL、安全紅線、Dashboard 人工清單 |
| 產出 | `references/reporting.md` | 報告格式、tasks.csv 寫入規則、gh issue 範本 |

## 審查原則（所有範圍共通）

1. **全程唯讀**：審查期間不修任何程式碼、不改任何設定、不執行任何 mutation。修復是之後的獨立任務。
2. **嚴重度定義**：
   - **P0**＝正在影響客人、或會弄壞／遺失資料
   - **P1**＝對外開放／上線前必修（安全、個資、金流正確性）
   - **P2**＝品質改善（一致性、可維護性、可觀測性）
3. **每個發現必附**：檔案位置（`path:line`）、具體失敗情境（什麼輸入／狀態→什麼錯誤結果）、建議修法。**無法給出失敗情境的不算發現**——這條同時是防幻覺機制：強迫推理而非模式比對。
4. **看「設計了但沒用到什麼」**：schema 的約束／欄位／表若程式從未使用，防線可能形同虛設。每個防護機制都要找到程式使用點。
5. **先建立基準**：開始前讀 `CLAUDE.md`、`docs/tasks.csv`、`git log --oneline -15`。
6. **輸出前強制去重**：所有發現先與 `docs/tasks.csv`（審查發現類任務）＋ `gh issue list --state all` 比對——**依根本原因比對、不是依檔案位置**。已列管未修的不重報（報告末尾帶過狀態）；標示已修的要驗證修法正確，修錯＝新發現；部分重疊的報新增部分並註明關聯。完整程序見 `references/reporting.md` 步驟 0。不可因「該區域已有列管問題」就跳過不看——那裡曾出過問題，代表值得再看。

## 執行流程

1. 建立基準（原則 5）
2. **第一遍**：讀 `references/adversarial-questions.md` → 依範圍的閱讀地圖（code-checklist.md 開頭）走讀程式碼，只帶問題集、不帶清單 → 記下所有發現與疑點
3. **第二遍**：讀對應範圍 checklist → 逐類別掃描 → 歷史案例回歸核對
4. **flow 範圍**（full 時最後跑）：
   - 測試覆蓋：關鍵路徑（webhook、createOrder、狀態機）有無自動化測試
   - 告警缺口：「哪些故障會在客人抱怨之前被發現？」逐一檢視 webhook 失敗／email 失敗／訂單卡 pending
   - 文件一致性：`docs/data-model.md`、`user-flow.md` 是否跟上實作演進
   - 依賴安全：`pnpm audit`
5. 依 `references/reporting.md` 產出：發現自動寫入 `docs/review-findings.md`（無人值守亦可）；**只有 md 中使用者標「確認」的項目**才轉 tasks.csv＋GitHub issues

## 歷史審查記錄

- **2026-07-02 全面審查**：產出 T67–T83＋GitHub issues #9–#23、#25。案例已編入各 checklist 作校準範例。
