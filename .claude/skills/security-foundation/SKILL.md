---
name: security-foundation
description: 資安地基漂移檢核（地基審查, 不變式檢查, security foundation, 漂移, drift check）。依 docs/security-foundation.md 的不變式清單逐條機械驗證（grep＋定點讀），判定 ✅持平／⚠️漂移／❌破口；與開放式 dev-review 互補——dev-review 找未知新缺陷，本 skill 驗已知防線是否被新程式繞過或失同步。有固定 routine 定期排程＋動到地基的 PR merge 後可手動觸發。
---

# security-foundation：資安地基漂移檢核

與 dev-review 的分工：dev-review 開放式對抗審查找**未知**缺陷；本 skill 逐條驗證**已知**不變式是否漂移（新程式繞過 helper、清單失同步、前提失效）。歷史上 F-021／F-017／matcher 失同步全屬後者——開放式審查抓這類靠運氣，檢核表抓是必然。

## 使用方式

- `/security-foundation`：檢查上次戳記以來的變動
- 排程：固定雲端 routine 定期執行（**實際班表以系統 routines 設定為準**，不在文件寫死星期）；頻率規則與退場條件見 `docs/security-foundation.md` 開頭，**每月檢視一次頻率**

## 流程

1. **讀清單**：`docs/security-foundation.md` 全文（斷言／錨點／驗法／例外）。
2. **定範圍**：`git log <上次戳記>..origin/master --oneline`（上次戳記＝本檔輸出章節記錄的 commit；首次跑用最近一次資安批次 merge）。範圍內無任何 commit 動到 `src/`／`supabase/`→ 記錄「本期無變動」即收。
3. **逐條驗證**：每條跑其機械驗法（grep／清單比對）；**只對本期有變動的區域深讀**，無變動條目快速驗過。禁跳過任何條目——「上期 ✅」不是本期證據。
4. **三態判定**：
   - ✅ 持平：驗法通過。
   - ⚠️ 漂移：防線在但有繞過點／失同步／描述過時 → 依 dev-review 同規則寫入 `docs/review-findings.md`（F 編號永久遞增、去重不重報），走 ②使用者裁決 → ③轉任務管線。
   - ❌ 破口：斷言不成立 → **當場停**，回報並建議使用者觸發深審（ultra 或本機 max）聚焦該面向。
5. **記錄戳記**：於 `docs/review-findings.md` 的審查記錄表加一列（日期／範圍 commit／逐條結果摘要），作為下次的起點。
6. **清單自身健檢**：錨點檔案是否仍存在、驗法是否仍可執行；失效即修（清單過時＝機制失效）。

## 護欄

- 唯讀審查：不改程式；發現問題走 findings 管線，不順手修。
- 單 session、不派 subagent（驗法設計為 grep 級，成本 5–10 分鐘）。
- 與 dev-review 錯開排程（**實際班表以系統 routines 設定為準**）；同一發現兩邊都撞到時依 F 編號去重。
- 清單維護責任在 dev-next 結案流程（動到地基的 PR merge 時同步增修清單），本 skill 只驗證不擴寫——但第 6 步發現清單過時可修清單本身。
