# docs-index.md — incantochen 文件目錄

> 更新日期：2026-06-27  
> 用途：讓 Claude Chat 與 Claude Code 對齊文件位置與用途，避免讀錯檔案。

---

## 根目錄 `jewelry-shop/`

| 檔案 | 用途 |
|------|------|
| `CLAUDE.md` | **Claude Code 主入口**。專案施工圖：技術棧、開發規則、目前狀態。每次對話自動載入。 |
| `memory.md` | **開發決策與狀態記錄**。里程碑進度、已完成事項、待決策、跨對話記憶。 |
| `incantochen-docs.skill` | Claude Skill 定義檔，規範文件寫作規則（doc-header、狀態 emoji、雙語慣例等）。 |

---

## `jewelry-shop/docs/`

### 規劃文件

| 檔案 | 用途 |
|------|------|
| `PRD.md` | 產品需求文件。目標客群、Persona、MVP 成功指標、功能範圍界定。 |
| `user-flow.md` | 使用者流程。首購下單／回訪查單／售後申請等主要動線。 |
| `IA.md` | 資訊架構。網站地圖、導覽結構、URL 規劃（SEO）。 |
| `brand-guide.md` | 品牌指南。色票（Primary Emerald `#063B2F`、Secondary Gold `#C5A059`）、字體、設計語言。 |
| `competitive-analysis.md` | 競品分析。高端訂製珠寶站的配置器／呈現／結帳比較。（位於 `../docs/`，見下方） |

### 資料層

| 檔案 | 用途 |
|------|------|
| `data-model.md` | 資料模型說明。13 張表定義、欄位說明、關聯邏輯。 |
| `jewelry_mvp_ER.mermaid` | ER Diagram 原始碼（Mermaid 格式），隨時可讀。 |
| `jewelry_mvp_ER.pdf` | ER Diagram 視覺版（171KB）。**非必要載入**，需要視覺參考時再開。 |
| `migration-runbook.md` | Migration 操作手冊。schema 異動流程、Supabase CLI 指令、注意事項。 |
| `migration-guide.md` | Migration 概念說明。新增 migration 的規則與原則。 |

### 任務與決策

| 檔案 | 用途 |
|------|------|
| `tasks.csv` | **開發任務清單**（原 xlsx `任務清單` 分頁）。P01–P05 已完成，含預估人天、累積人天、優先級、狀態。 |
| `decisions.csv` | **待決策事項**（原 xlsx `待決策事項` 分頁）。決策項目、現況、結論、關聯任務、狀態。 |
| `sprint_overview.csv` | Sprint 總覽（原 xlsx `Sprint總覽` 分頁）。里程碑時程備忘。 |

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

### 其他

| 檔案 | 用途 |
|------|------|
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
2. `memory.md` — 決策脈絡與里程碑進度
3. `docs/tasks.csv` — 當前任務與依賴
4. 對應功能的規劃文件（PRD / IA / user-flow / data-model）
