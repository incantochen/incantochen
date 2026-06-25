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

#### #T05 / M0 會員 / Supabase Auth 設定（Email OTP 主＋Magic link 輔）
**說明**：插隊任務（涉及 auth，先進 plan mode 核准後執行）。設定 Auth provider 讓 T06 登入 UI 開工前就位；範圍僅 redirect 白名單與 email 樣板，不含 `/auth/confirm` 頁面與登入 UI 本身。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 本機完成（2026-06-25）；⚠️ production 待使用者手動設定 |
| 產出 | `supabase/config.toml`（修改）、`supabase/templates/magic_link.html`（新增） |
| 更新描述 | 1. 修正 `additional_redirect_urls` 協定不一致 bug（原 `https://127.0.0.1:3000`，與 `site_url` 的 `http://` 不一致），改為 `["http://127.0.0.1:3000/**", "http://localhost:3000/**"]`。2. 新增 `[auth.email.template.magic_link]` 自訂樣板，內容顯示 6 碼 OTP（`{{ .Token }}`）＋連結改指向自家 `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`（而非 Supabase 預設直接驗證的端點），符合 user-flow.md「連結落地頁須再按一次登入才消耗 token」的防護需求。3. `content_path` 路徑解析是相對於專案根目錄（cwd），不是相對於 `supabase/config.toml` 所在目錄——首次寫成 `./templates/...` 會找不到檔案，需寫 `./supabase/templates/...`（沿用既有 `invite` 註解範例的寫法）。4. `supabase stop`＋`start` 重啟套用設定。5. 端到端驗證：`POST /auth/v1/otp` 觸發信→Mailpit 確認信件主旨／OTP 碼／連結格式全部正確→`POST /auth/v1/verify` 用該 OTP 碼成功換得 access token。 |
| 待辦 | **production（cloud project `wdmigbqdhernmrfpzzxk`）尚未設定，需使用者手動到 Supabase Dashboard**：① Authentication → URL Configuration：Site URL 設 `https://jewelry-shop-delta.vercel.app`，Redirect URLs 新增 `https://jewelry-shop-delta.vercel.app/**` 與 `https://jewelry-shop-git-staging-fishead02290-3279s-projects.vercel.app/**`。② Authentication → Emails → Magic Link：貼上 `supabase/templates/magic_link.html` 的內容（`{{ .SiteURL }}` 在雲端會自動解析成正式網址，不用改）。 |
| 驗收 | 本機 Mailpit 收信內容：OTP 碼正確顯示、連結正確指向 `/auth/confirm`；`verify` API 成功換 token。production 端到端測試留待 T06（登入 UI／`/auth/confirm` 頁面）完成後再做。 |
| 依賴 | T02 ✅ |

---

#### #T15 / M1 前台 / 戒指商品詳情頁（骨架）
**說明**：以種子資料開發戒指商品詳情頁（PDP）骨架，路由 `/products/[slug]`，為配置器（T16）做地基。涉及多檔案＋設計決策，先進 plan mode 核准後執行。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | `src/app/products/[slug]/page.tsx`（新增）、`src/components/site-header.tsx`（新增）、`src/components/site-footer.tsx`（新增）、`src/app/layout.tsx`（修改，接入 header/footer） |
| 更新描述 | 1. **Wireframe 落差**：`docs/wireframe/` 實際不存在（memory.md 記載有誤），改用使用者指出的備份 HTML demo `backup/_backup_docs_20260624_235506/proj-docs/Demo/Demo_0623/product.html` 當版面參考。2. 該 demo 是「完工狀態」（含配置器互動／即時換圖／即時計價／加入購物袋），T15 範圍縮小為骨架：麵包屑、圖片佔位（lucide `Gem` icon）、商品名稱／類別／預設選配價格、三組選項以**靜態 chip** 呈現（標出 `is_default`，無 `onClick`）、交期告知（`XX` 佔位，天數未定為已知待辦）、靜態「加入購物袋」按鈕。3. **刻意省略**「關於這件作品／材質與保養」「猜你喜歡」——`product` 表無描述欄位、seed 僅 1 款商品，不杜撰假內容/假商品卡。4. 資料撈取：Server Component 用 `createClient()`＋ Supabase 巢狀 `select`（`product_option → option_type` ＋ `product_option_value → option_value`）一次撈三層白名單；找不到商品走 `notFound()`。5. Tailwind token 與 wireframe CSS 變數高度重合（`--emerald`→`primary`、`--gold`→`secondary-400`、`paper/cloud/stone/ash/ink` 同名），幾乎無需另定顏色。6. 新增 `SiteHeader`／`SiteFooter` 共用元件接入 root layout，避免之後每頁重複搭（純靜態，無購物車數量／登入狀態，留給 T07/T08/T20/T21 接資料）。7. **環境問題排查**：`pnpm dev` 開發時 PDP 一直 404，原因是 `.env.local` 的 `NEXT_PUBLIC_SUPABASE_URL` 指向**雲端 production**而非本機，T43 seed 當時只下在本機 `supabase db reset --local`，雲端 `product` 表是空的；已用 `supabase db query --linked --file supabase/seed.sql` 把同一份 seed（固定 UUID＋`ON CONFLICT DO NOTHING`，重複執行安全）也套到雲端，問題排除。8. 用 Playwright（`npx playwright install chromium`，無 `chromium-cli` 故用 `_electron` 模式改寫的純 `chromium.launch()` 腳本）截圖驗證：正常 slug 顯示完整骨架且樣式正確、假 slug 正確回 404、無 console error。9. 修正一處小 bug：類別 eyebrow 標籤原寫 `categoryLabel.toUpperCase()`（中文呼叫 toUpperCase 無效，顯示「戒指 · 戒指」），改用 `product.category`（英文 code）+ CSS `uppercase` class，正確顯示「RING · 戒指」。 |
| 待辦 | （無，已完成）。之後若要再加測試/示範資料，記得本機＋雲端都要各跑一次 seed（見 CLAUDE.md 頂部環境提醒）。 |
| 驗收 | `pnpm lint` 通過、`tsc --noEmit` 無型別錯誤；Playwright 截圖確認 `/products/emerald-solitaire-ring` 正常渲染、`/products/not-a-real-slug` 回 404。 |
| 依賴 | T43 ✅、T39 ✅（基礎部分） |

---

#### #T16 / M1 配置器 / 配置器 UI（戒指選項）
**說明**：把 T15 的靜態選項 chip 變成可互動配置器——點擊切換選取、狀態管理。先進 plan mode 簡單規劃後執行。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | `src/components/product-configurator.tsx`（新增，client component）、`src/app/products/[slug]/page.tsx`（修改） |
| 更新描述 | 1. 把選項 chip／數量 stepper／CTA 按鈕從 page.tsx 抽到新的 client component，定義乾淨的 `ConfiguratorOption` 型別（不直接帶 Supabase 生成型別進 client，page.tsx 負責把巢狀資料整理成這個形狀再傳入）。2. `selected` 用 `Record<optionId, valueId>`，初始值取各 option 的 `isDefault`；`quantity` 用 `useState(1)`，stepper `-` 在 1 時 disabled。3. **價格刻意不隨選取或數量連動**——維持 T15 的靜態 `startingPrice`，這是 tasks.csv 的任務切分（T18 報價引擎才負責即時計價），不是漏做。4. Playwright 驗證：點「藍寶石」「18K 白金」chip 後樣式正確切換選中（祖母綠/18K黃金正確取消選中）、戒圍維持預設未受影響、stepper +兩次數量正確變 3、無 console error。 |
| 待辦 | （無，已完成） |
| 驗收 | `pnpm lint`／`tsc --noEmit` 通過；Playwright 點擊後截圖確認選取狀態與數量正確。 |
| 依賴 | T15 ✅ |
| 注意 | 白名單驗證仍以伺服器資料為準，前端互動只是 UI 狀態，不得讓使用者選到白名單外的值（目前資料來源即為白名單查詢結果，無繞過風險） |

---

### 下次作業

#### #T17 / M1 配置器 / 選項即時換圖
**說明**：選項變動時主圖即時切換（搭配 T55 疊圖機制，T56 3D 素材未完成前先用現有 placeholder 邏輯延伸）。

| 項目 | 內容 |
|------|------|
| 狀態 | ⬜ 未開始 |
| 更新描述 | — |
| 待辦 | 待 T56 素材或至少有暫定圖檔策略後再細化 |
| 依賴 | T16 ✅、T55（尚未開始）、T56（尚未開始） |
| 注意 | MVP 不做 3D 即時預覽；本任務範圍是「依選項換靜態合成圖」，非 3D 渲染 |

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
