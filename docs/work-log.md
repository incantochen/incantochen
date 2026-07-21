# work-log.md — incantochen 工作日誌（接手用時間軸）

> **定位（2026-07-22 瘦身改版）**：跨對話**接手用**的時間軸——每則幾行：動了哪些任務、產出、下一步，**指向 PR#／任務 ID，不重寫任務細節**。
> - 任務**完整細節**看 PR / git commit；結案索引見 `tasks-done.md`；待辦見 `tasks-todo.csv`；決策見 `decisions.csv`。
> - 2026-07-18 以前的舊式長篇日誌全文封存於 `work-log-archive.md`。
> - 維護原則：一則保持精簡（3–5 行）；只增當前狀態與下一步，過時細節不回填。

## 📋 範本（複製使用）

```
## 📅 YYYY-MM-DD
- **動了**：T##（PR #n）— 一句話
- **產出**：檔案／migration／commit（指標即可）
- **下一步**：T##／待辦
```

---

## 📅 2026-07-22
- **動了**：記錄類文件治理重構（本 PR）——tasks.csv 拆成 `tasks-todo.csv`（38 筆待辦）＋`tasks-done.md`（108 筆結案索引）；work-log 瘦身＋封存 `work-log-archive.md`；memory.md 路線 1 瘦身、§6 決策刪除（decisions.csv 為唯一權威）；CLAUDE.md 修過時事實（14→16 表、0007→0021）；docs-index 同步。
- **產出**：新增 tasks-todo.csv／tasks-done.md／work-log-archive.md；改寫 work-log／memory／CLAUDE／docs-index；刪 tasks.csv（git 保留）。
- **下一步**：回歸正常開發——待辦挑選見 `tasks-todo.csv`（M2 收尾：T106 測試、T126 對帳小時級、T138 購物車失效偵測等）。

## 📅 2026-07-20 ～ 07-21（文件視覺化系列，PR #98–#114）
- **動了**：把系統知識做成可分享儀表板與文件——多為純 docs。
- **產出**：四份自帶樣式 HTML（`architecture.html`／`order-state-machine.html`／`glossary.html`／`system-flow-and-user-flow.html`）＋對應 md；`architecture.md` 全面刷新至 M2 現況；新增 `system-flow-and-user-flow.md`、`glossary.md`、`security-account-key-ops.md`（T91 展開）；移除未啟用重複的 `incantochen-docs.skill`；登記 **T139**（Google OAuth 登入）、**T140**（並發不變式整合測試，T106 子任務）。
- **下一步**：本次記錄類文件重構（見 07-22）。

## 📅 2026-07-18（PR #71 / #84）
- **動了**：**T127**（webhook 側卡單三段修法：取消守衛下沉 transitionOrder＋reconcile 漂移臂/稽核臂＋金額防呆；與 T110 手動合流）；**T81/T133**（會員購物車合併＋proxy 預簽 guest_token）。
- **產出**：`find-paid-payment.ts`／`mark-pending-payments-failed.ts`／`resolve-cart-identity.ts`／`merge-guest-cart.ts` 等；migration 0018；ops-runbook §1.1/§6.1。
- **下一步**：T128（abortReason 合併，P3）；T129–T133 dev-review findings。

## 📅 2026-07-17（PR #72）
- **動了**：**T110** 訂單狀態＋稽核 log 寫入交易化（`transition_order_status` RPC，migration 0017）——消滅「狀態已變、log 缺漏」中間態。
- **產出**：migration 0017（已套雲端）；`state-machine.ts` 收斂三處分歧；ops-runbook §1 失敗語意。
- **下一步**：T127（webhook 側卡單，max review 衍生）。

---

> 更早的逐次作業（2026-06-25 ～ 07-15，含 M0/M1/M2 大量任務的長篇紀錄）全文見 **`work-log-archive.md`**。
