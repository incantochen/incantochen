# work-log.md — incantochen 工作日誌

> 路徑：`jewelry-shop/docs/work-log.md`  
> 用途：每次作業前填「本次」、結束前填「下次」，讓 Claude Chat 與 Claude Code 快速接手。  
> 格式：每節一個任務區塊，狀態用 emoji（✅完成 ⏳進行中 ⬜未開始 ⏭️跳過 ⚠️阻塞）

---

## 📅 2026-06-25

### 本次作業

#### #文件整理 / 規劃工具
**說明**：將 MVP 開發任務清單 xlsx 轉為 CSV；建立文件目錄索引與工作日誌範本。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成 |
| 產出 | `docs/tasks.csv`、`docs/decisions.csv`、`docs/sprint_overview.csv`、`docs/docs-index.md`、`docs/work-log.md` |
| 更新描述 | tasks.csv 以最新版 xlsx 轉換（P01–P05 狀態已完成）；累積人天為實際數值。docs-index.md 列出兩個目錄位置的所有文件與用途。CLAUDE.md 補入文件目錄引用。 |
| 待辦 | 將產出檔案放入 `jewelry-shop/docs/`；在 CLAUDE.md 最上方加入 docs-index 引用一行。 |

---

#### #T43 / M0 資料 / dev seed
**說明**：建立本機開發種子資料，供 M1 戒指配置器開發使用。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（Claude Chat 產出＋Claude Code 本機驗收通過，2026-06-25） |
| 產出 | `supabase/seed.sql`、`docs/verify-seed.sql`（修正版） |
| 更新描述 | 以 CTE + ON CONFLICT DO NOTHING 冪等設計寫入 seed.sql。內容：1 款戒指（emerald-solitaire-ring，底價 NT$25,000）、3 個 OptionType（gem_color/metal_color/ring_size）、8 個 OptionValue（3 寶石色/2 金屬色/3 戒圍）、3 個 ProductOption、8 個 ProductOptionValue（含 price_delta 與 is_default）。使用固定 UUID，可重複執行，末尾 SELECT 顯示各步驟插入數量供驗收。本機跑 `supabase db reset --local` 套用，發現並修正 bug：`option_type` 表無 `sort_order` 欄位，seed.sql／verify-seed.sql 誤用，已移除該欄位引用。此 CLI 版本（2.107.0）無 `db seed`／`db execute` 子指令，改用 `supabase db query --local "<sql>"` 逐條驗收（含 enum 欄位 `::text` 轉型繞過掃描限制）。驗收結果全數通過（products=1, option_types=3, option_values=8, product_options=3, product_option_values=8；白名單與完整性查詢符合預期）。 |
| 待辦 | （無，已完成） |
| 依賴 | T03 ✅、T46 ✅ |

---

### 下次作業

#### #T15 / M1 前台 / 戒指商品詳情頁
**說明**：以種子資料開發戒指商品詳情頁（PDP），路由 `/products/[slug]`，為配置器（T16）做地基。

| 項目 | 內容 |
|------|------|
| 狀態 | ⬜ 未開始 |
| 更新描述 | — |
| 待辦 | 1. 先讀 `docs/brand-guide.md`、`docs/user-flow.md`、`docs/wireframe/` 對應頁面<br>2. 建立 `src/app/products/[slug]/page.tsx`，從 Supabase 抓商品資料（含選項白名單）<br>3. 呈現商品名稱、底價、主圖佔位（3D 素材 T56 尚未完成，先用 placeholder）<br>4. 確認品牌色票與字體已正確套用（globals.css @theme ✅）<br>5. 跑 lint，pnpm dev 確認無錯誤 |
| 依賴 | T43 ✅（seed 驗收後）、T39 進行中（UI kit 樣式）、T02 ✅（Supabase client） |
| 注意 | PDP 路由為 `/products/[slug]`（IA 定案）；配置器內嵌 PDP，無獨立 config route；商品圖 T56 未完成前用佔位圖，不阻塞開發 |

---

---

## 📋 日誌範本（複製使用）

```
## 📅 YYYY-MM-DD

### 本次作業

#### #任務ID / 模組 / 說明
**說明**：（一句話描述本次目標）

| 項目 | 內容 |
|------|------|
| 狀態 | ⬜ / ⏳ / ✅ / ⚠️ |
| 產出 | （檔案、commit、截圖等） |
| 更新描述 | （做了什麼、改了什麼） |
| 待辦 | （本次未完成的項目） |

---

### 下次作業

#### #任務ID / 模組 / 說明
**說明**：（一句話描述下次目標）

| 項目 | 內容 |
|------|------|
| 狀態 | ⬜ 未開始 |
| 更新描述 | — |
| 待辦 | （具體步驟） |
| 依賴 | （前置任務 ID） |
| 注意 | （風險或限制） |
```
