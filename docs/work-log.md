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

#### #T04 / M0 基礎建設 / 部署到 Vercel 並打通 CI
**說明**：插隊任務（M1 主線之外），在開始 T15 前先確保部署/CI 基礎設施就位，降低後期金流整合風險。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | GitHub repo `github.com/incantochen/incantochen`、Vercel 專案 `jewelry-shop` |
| 更新描述 | 1. repo 原本無 git remote，新增 origin 並 push 既有 commit。2. `vercel link` 建立專案，但自動連接 GitHub 失敗兩次：先缺帳號層級 Login Connection，補上後仍缺 GitHub App 對該 repo 的存取授權（需在 GitHub Installed GitHub Apps 設定，非單純 OAuth 登入連線）；安裝 Vercel GitHub App 並勾選 Commit Comments、Consolidated Commit Status 權限後，`vercel git connect` 顯示 already connected（CLI 對「已連接」狀態回傳 exit code 1，屬已知 UX 瑕疵，非錯誤）。3. Supabase 環境變數（`NEXT_PUBLIC_SUPABASE_URL`／`NEXT_PUBLIC_SUPABASE_ANON_KEY`，特別注意要用 anon/public key、不可用 service_role/secret key）由使用者本人直接於 Vercel Dashboard 設定，未經過 Claude（依 `.env*` 紅線）。4. `vercel --prod` 完成首次部署成功。5. 用空 commit push 驗證 CI：30 秒內自動觸發新 production 部署，確認 git push 自動部署生效。 |
| 待辦 | （無，已完成）。正式網域待 T35 上線階段再設定（目前用 Vercel 預設 `*.vercel.app` 子網域，與最終正式網址無關，可隨時換） |
| 驗收 | production：`https://jewelry-shop-delta.vercel.app`（Ready） |
| 依賴 | T01 ✅ |

---

#### #T52 / M0 流程 / Staging 環境（Vercel preview）
**說明**：插隊任務，緊接 T04 驗證 Vercel 分支預覽機制，留給日後 ECPay sandbox 等金流測試用固定網址。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | git 分支 `staging` |
| 更新描述 | 建立並 push `staging` 分支，確認 Vercel 自動產生 Preview（非 Production）部署；該分支有穩定別名（不隨每次部署變動），可作為金流回拋網址等固定測試端點。 |
| 待辦 | （無，已完成） |
| 驗收 | preview 穩定別名：`https://jewelry-shop-git-staging-fishead02290-3279s-projects.vercel.app` |
| 依賴 | T04 ✅ |

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
