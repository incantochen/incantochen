# docs-index.md — incantochen 文件目錄

> 更新日期：2026-07-08  
> 用途：讓 Claude Chat 與 Claude Code 對齊文件位置與用途，避免讀錯檔案。

---

## 根目錄 `jewelry-shop/`

| 檔案 | 用途 |
|------|------|
| `CLAUDE.md` | **Claude Code 主入口**。專案施工圖：技術棧、開發規則、目前狀態。每次對話自動載入。 |
| `memory.md` | **開發決策記錄（durable decisions）**。品牌/客群/技術選型/已定決策/MVP 範圍。2026-07-08 起**不再記進度**——進度以 `docs/tasks.csv` 為準。 |
| `incantochen-docs.skill` | Claude Skill 定義檔，規範文件寫作規則（doc-header、狀態 emoji、雙語慣例等）。 |

---

## `jewelry-shop/docs/`

### 規劃文件

| 檔案 | 用途 |
|------|------|
| `PRD.md` | 產品需求文件。目標客群、Persona、MVP 成功指標、功能範圍界定。 |
| `user-flow.md` | 使用者流程。首購下單／回訪查單／售後申請等主要動線。 |
| `system-flow-and-user-flow.md` | **四層系統流程統整**（2026-07-20 產出）。Level 1 User Flow→Level 2 系統流程（成立條件/例外）→Level 3 系統錯誤自動處置→Level 4 人工救援；附錄含訂單狀態機細節與金流兜底對帳三臂（主臂/漂移臂/稽核臂）。跨層對齊，內容以程式碼與 `ops-runbook.md` 接地。 |
| `order-state-machine.html` | **訂單狀態機視覺化**（自帶樣式單檔，瀏覽器直接開）。七狀態六邊的觸發者/守衛/副作用/例外、取消守衛 TOCTOU 並發時序、對帳三臂、守衛分層總表。`system-flow-and-user-flow.md` 附錄 A/B 的圖解版。 |
| `IA.md` | 資訊架構。網站地圖、導覽結構、URL 規劃（SEO）。 |
| `brand-guide.md` | 品牌指南。色票（Primary Emerald `#063B2F`、Secondary Gold `#C5A059`）、字體、設計語言。 |
| `competitive-analysis.md` | 競品分析。高端訂製珠寶站的配置器／呈現／結帳比較。（位於 `../docs/`，見下方） |

### 資料層

| 檔案 | 用途 |
|------|------|
| `architecture.md` | **系統架構盤點**。模組職責、相依關係、Runtime Flow、第三方服務互動、部署架構、Gap Analysis（2026-07-07 產出）。 |
| `data-model.md` | 資料模型說明。14 張表定義（含 T33 `support_request`）、欄位說明、關聯邏輯、快照契約。 |
| `jewelry_mvp_ER.mermaid` | ER Diagram 原始碼（Mermaid 格式），隨時可讀。 |
| `jewelry_mvp_ER.pdf` | ER Diagram 視覺版（171KB）。**非必要載入**，需要視覺參考時再開。 |
| `migration-runbook.md` | Migration 操作手冊。schema 異動流程、Supabase CLI 指令、注意事項。 |
| `migration-guide.md` | Migration 概念說明。新增 migration 的規則與原則。 |

### 任務與決策

| 檔案 | 用途 |
|------|------|
| `tasks.csv` | **開發任務清單＝唯一權威任務來源**。全任務（P01–P05、T01–T106+）含依賴、預估人天、優先級、狀態；審查衍生任務也登記於此。標題帶 🚀＝上線必要（分級見 launch-scope.md）。 |
| `launch-scope.md` | **上線必要子集**（2026-07-08 產出）。A 硬性／B 體驗必要／C 決策擋路（含決策期限）／D 上線後可修四級分類＋外部依賴清單；「距離上線還差什麼」看這份。 |
| `decisions.csv` | **待決策事項**（原 xlsx `待決策事項` 分頁）。決策項目、現況、結論、關聯任務、狀態。 |
| `sprint_overview.csv` | Sprint 總覽——**2026-06-24 原始估算基準（歷史參考）**；其後新增的審查任務未計入，現況以 `tasks.csv` 為準。 |

### 開發日誌與驗收

| 檔案 | 用途 |
|------|------|
| `work-log.md` | **工作日誌**。每次作業的完成項目、產出、更新描述、待辦事項。跨對話接手時必讀。 |
| `verify-seed.sql` | 種子資料驗收 SQL。確認 seed.sql 套用後各表欄位正確性的逐條查詢。 |

### 工程品質系統

| 檔案 | 用途 |
|------|------|
| `coding-system.md` | **寫程式的思考系統**。逆向推理四問、系統性思考（狀態機／並發／重試迴路）、PR 前檢核清單、真實 bug 案例庫。**寫任何程式碼前必讀**；review 發現新 bug 類型時回寫補充。 |
| `review-findings.md` | 審查發現與回歸狀態。dev-review 產出，含檔案覆蓋表。 |
| `dev-process.md` | **開發流程全貌**（2026-07-08 產出）。需求→規劃→開發→審查→測試→PR→部署→維運全流程圖（Mermaid）、流程×文件×工具對照、自動化清單、流程 Gap Analysis。 |
| `test-plan.md` | **E2E 測試計畫與紀錄規範**（2026-07-08 產出，實作＝T106）。code review 後的自動測試階段：S1–S7 案例矩陣、`verify:all` 一鍵流程、測試紀錄自動產出規範、資料安全紅線。 |

### 營運

| 檔案 | 用途 |
|------|------|
| `ops-runbook.md` | **人工救援 Runbook**（T90，2026-07-08 初版）。已知異常情境的判斷方法、修復 SQL／操作步驟、修復順序與風險、何時聯絡綠界。 |
| `ecpay-blueprint/` | **ECPay 金流架構藍圖**（2026-07-07 產出，與專案無關的可重用規劃，19 份文件）。服務全景／API 能力矩陣／架構／流程／測試藍圖；閱讀路徑見其 `README.md`。 |
| `ecpg-migration-plan.md` | **站內付 2.0 取代 AIO 信用卡規劃**（2026-07-08 產出，📋 未定案）。執行方案（五階段）、影響範圍、測試規劃、Pass Criteria；建議 MVP 上線後才動工。 |

### 其他

| 檔案 | 用途 |
|------|------|
| `glossary.md` | **專有名詞縮寫對照**（2026-07-20 產出）。六領域（開發流程／資料庫／金流 ECPay／安全／前端／本專案自訂概念）＋第三方服務對照；每條「縮寫—全稱—白話說明」一行，跨對話快速查閱。 |
| `glossary.html` | **glossary 互動版**（自帶樣式單檔，瀏覽器直接開）。即時搜尋＋七領域分類篩選＋命中高亮；內容與 `glossary.md` 同步。 |
| `setup-checklist.md` | 環境建置 Checklist。初始安裝步驟確認清單。 |

### 視覺參考

| 檔案 | 用途 |
|------|------|
| `wireframe/` | P05 線框（低保真）：`index`／`collection`／`product`／`cart`／`checkout`／`account`／`custom`／`payment-result`。做任何 UI／頁面前先讀對應頁面。 |

---

## `incantochen/docs/`（專案根層）

| 檔案 | 用途 |
|------|------|
| `competitive-analysis.md` | 競品分析文件（與 `jewelry-shop/docs/` 同步確認版本）。 |
| `Demo/` | Demo 相關素材資料夾。 |

---

## 文件優先讀取順序建議

開發任務時，建議依序參考：

1. `CLAUDE.md` — 技術規則與目前狀態
2. `docs/tasks.csv` — 當前任務與依賴（進度唯一權威來源）
3. `docs/work-log.md` — 最近一次作業細節（跨對話接手）
4. 對應功能的規劃文件（PRD / IA / user-flow / data-model / architecture）
5. `memory.md` — 決策脈絡（需要「為什麼這樣定」時再讀）
