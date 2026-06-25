# 專案記憶 memory.md

> 文件更新日期：2026-06-24
> 高端客製化寶石飾品電商平台 — 開發決策與狀態記錄
> 最後更新：M0 資料層完成——T03 建表＋T46 RLS 已套用至雲端 production（13 表＋11 policy）、型別已生、commit c124482；T43 dev seed 已完成並本機驗收通過（2026-06-25）；下一步 T15 戒指商品詳情頁
> 用途：快速掌握專案脈絡與已定決策，避免重複討論。

---

## 1. 專案概述

**品牌：incantochen**（incanto＝義大利文「著迷／魔法」＋ chen）。販售高端半客製彩色寶石飾品。兩種模式：

- **半客製**（MVP 範圍，**全品類**：戒指/耳環/手鍊/項鍊）：標準款＋客人選配（寶石／金屬色／尺寸或長度／數量），價格選配當下即算，走標準電商結帳。
- **全客製**（Phase 3；MVP 僅做預約／詢問表單）：依需求打造，需報價→確認書→鎖價。

**核心策略：單人開發、骨架優先、戒指起步、後續再擴充其他品類。**

---

## 2. 當前狀態

- ✅ 系統架構圖、半客製流程圖、ER 圖（13 張表）、開發起步文件、開發任務清單（70 任務）皆已完成。
- ✅ 待決策事項全部收斂（9 已定調、1 暫緩、1 提醒）。
- ✅ **M-1 產品規劃全數完成**：競品分析／PRD／User Flow／Brand Guide／**IA／Wireframe** 皆已產出（見 §9、§12）。另有 homepage demo 作設計定稿參考。
- ✅ **M0 環境與骨架前置完成**（見 §11）：開發環境裝好、Next.js 16 專案骨架建立、`CLAUDE.md` 與 6 個 hooks 落地、首次 git commit 完成。
- ✅ **DB migration 工具定案：Supabase CLI**（規範見 `docs/migration-guide.md`）——T03 前置已解。
- ✅ **M0 資料層完成並套用雲端**：T03 建表＋T46 RLS 已 `db push` 至雲端 production（project-ref `wdmigbqdhernmrfpzzxk`，13 表＋11 policy，雲端驗收通過）；型別已生於 `src/types/database.types.ts`；commit `c124482`。欄位級規格見 `docs/data-model.md`。
- ✅ **T43 dev seed 已完成，本機＋雲端 production 皆已套用**（2026-06-25）：`supabase/seed.sql`（1 款戒指＋3 OptionType＋8 OptionValue＋白名單），`supabase db reset --local` 套用＋驗收查詢全數通過；另用 `supabase db query --linked --file` 套用到雲端 production（因為 `.env.local` 接的是雲端，`pnpm dev` 看不到本機 seed）。過程中修正一處 bug：`option_type` 無 `sort_order` 欄位，seed.sql／docs/verify-seed.sql 已移除該欄位引用。⚠️ **環境提醒**：本機與雲端是兩份獨立資料，之後改 seed 兩邊都要各跑一次。
- ✅ **T04 部署到 Vercel＋CI 已完成**（2026-06-25）：repo push 至 GitHub（`github.com/incantochen/incantochen`），透過 Vercel GitHub App 連接專案 `jewelry-shop`，env vars 已設定，首次部署成功且驗證 push 自動觸發部署（CI）生效。production：`https://jewelry-shop-delta.vercel.app`。
- ✅ **T52 Staging 環境已完成**（2026-06-25）：`staging` 分支 push 後自動產生 Vercel Preview 部署，穩定別名 `https://jewelry-shop-git-staging-fishead02290-3279s-projects.vercel.app`，留給日後 ECPay sandbox 測試用。
- ✅ **T05 Auth（Email OTP＋magic link）本機設定已完成**（2026-06-25，先進 plan mode 核准後執行）：`supabase/config.toml`＋新增 `supabase/templates/magic_link.html`，本機端到端測試（觸發信→Mailpit 收信驗證內容→OTP 驗證換 token）全通過。**production 端尚待使用者手動到 Supabase Dashboard 設定**（Site URL／Redirect URLs／Magic Link 範本，見 `docs/work-log.md`）；`/auth/confirm` 頁面留給 T06／T07。
- ✅ **M0 全數完成；M1 開工，T15 戒指商品詳情頁骨架完成**（2026-06-25，先進 plan mode 核准後執行）：`src/app/products/[slug]/page.tsx`（Server Component，撈商品＋三層白名單靜態呈現）＋共用 `SiteHeader`／`SiteFooter`。wireframe 原訂位置 `docs/wireframe/` 實際不存在，改用備份資料夾的 HTML demo（`backup/_backup_docs_20260624_235506/proj-docs/Demo/Demo_0623/product.html`）當版面參考。刻意不做：配置器互動（T16-T20 範圍）、「關於這件作品」與「猜你喜歡」（schema 無描述欄位、seed 僅 1 款商品，缺真實內容不杜撰）。Playwright 截圖驗證通過（正常與 404 兩種情境）。
- ✅ **T16 配置器互動化完成**（2026-06-25）：新增 client component `src/components/product-configurator.tsx`（chip 點擊切換選取＋數量 stepper，狀態管理 `useState`）。價格刻意不隨選取連動，留給 T18。Playwright 點擊驗證通過。
- 📌 **流程變更（M1 起）**：改用 feature branch＋PR，不再直接 push master；PR 連結給使用者看過、回覆「沒問題」後才 merge（細節見記憶 `git-workflow-incantochen-pr-review`）。
- ⏭️ **下一步：T17 選項即時換圖。** 品牌／客群／價位帶／成功指標／動線等已定（見 §12）。

---

## 3. 技術選型（已鎖定）

> 詳細技術棧、版本策略、Next.js 16 注意事項見 `CLAUDE.md §2`，不在此重複。

**摘要**：Next.js 16 + React 19.2 + TypeScript (strict) + pnpm + Supabase (Postgres + Auth + Storage) + 綠界 ECPay（金流／物流／發票）+ Resend + Zod + Vercel 部署。

**本機環境**：Node.js 24、pnpm 11、Git 2.54、Claude Code 2.1.185。專案路徑 `…\incantochen\jewelry-shop`。

**成本**：基礎設施 $0（免費方案）；固定僅網域（約 NT$500/年）＋綠界每筆 ~2.x%。正式收單前升 Supabase Pro（約 US$25/月）。

---

## 4. MVP 範圍（戒指優先）

**做**：會員（結帳即會員＋magic link）、戒指商品與配置器、報價引擎、購物車、結帳、綠界金流、宅配、訂單狀態與通知、後台訂單管理、回頭補的後台商品 CRUD、上線法規配套。

**MVP 暫不做（後續/Phase 2+）**：3D 即時預覽（改用 3D 合成靜態疊圖）、LINE 通知、工單系統、品管模組、物流自動追蹤（手動貼單號）、其他品類（耳環/項鍊/手鍊，靠後台自行擴充）、全客製流程。

---

## 5. 資料模型（13 張表）

> 欄位級規格、三個核心設計、外鍵策略見 `CLAUDE.md §5` 與 `docs/data-model.md`，不在此重複。
> ER 圖視覺參考：`docs/jewelry_mvp_ER.mermaid`（文字，隨時可讀）；`docs/jewelry_mvp_ER.pdf`（視覺版，需要時再開）。

**13 張表**：Product、OptionType、OptionValue、ProductOption、ProductOptionValue、Member、Cart、CartItem、orders、OrderItem、Payment、OrderStatusLog、Notification。

**三個核心設計（摘要）**：① 資料驅動配置器（三層白名單）② 快照欄位釘住下單當下價格與規格 ③ Order 內嵌收件與物流（tracking_no 手動填）。

---

## 6. 已定決策（待決策分頁）

1. **金屬價格波動** → 暫緩（不影響開發，上架定價時抓成本緩衝）
2. **材料/庫存擋單** → 不擋單，以交期告知管理（商品頁/結帳/說明頁標示「下單後訂製、交期至少 XX」）
3. **訪客結帳** → 結帳即會員（無摩擦）＋ magic link
4. **七天鑑賞期** → 標準品適用；客製品主張法定例外，但須結帳告知同意(T57)＋條款載明(T36)；瑕疵仍可退。**用詞需律師審。**
5. **運費政策** → 台灣宅配段向客人收；國際段（海外工廠→台灣）內含商品定價、不另收
6. **退款範圍** → 客製限瑕疵/錯誤可退，走綠界金流退刷
7. **組合圖策略** → 程式合成：3D 素材(Blender)＋前端擬真疊圖（精緻：對齊＋陰影高光）
8. **配送方式** → 僅宅配（黑貓保價＋本人簽收）
9. **3D 素材** → 自學 Blender
10. **PII 欄位加密** → 不做；前提是不蒐集身分證號/銀行帳號（綠界包掉發票與退款）；未來若必收高敏欄位再針對該欄位加密
11. **營運前置（非開發，提醒）** → 商業/營業登記、綠界特店申請與審核需時間——提早平行去辦
12. **DB migration 工具** → Supabase CLI（手寫 SQL 於 `supabase/migrations/`）。理由：RLS 為 SQL、型別走 `gen types`、相依最少；勿引 ORM 管 migration。詳見 `docs/migration-guide.md`。

---

## 7. 安全／個資基線

> 完整安全規則、RLS 細節、金流冪等、登入防護見 `CLAUDE.md §6`，不在此重複。

**兩條紅線（不可省）**：伺服器端驗價（T41）、資料庫備份（T34）。

**關鍵決策摘要**：卡號不落地（綠界）、不做欄位級加密、有訂單會員刪除走匿名化（T63）、RLS ✅ 已套用（`0002`）、程式層護欄 ✅ 已設（6 個 hooks）。

---

## 8. 開發里程碑（單人純序列，含規劃 93 人天）

| 階段 | 目標 | 累積人天 | 狀態 |
|---|---|---|---|
| M-1 | 產品規劃（PRD／User Flow／IA／Wireframe／競品） | 5 | ✅ 完成 |
| M0 | 環境與骨架前置（含 RLS、magic link、3D 素材） | 16 | ✅ 環境與骨架部分完成（RLS/magic link/3D 屬後續任務） |
| M1 | 會走路的骨架：戒指可配置並付款 | 54 | ⬜ |
| M2 | 訂單營運閉環 | 63 | ⬜ |
| M3 | 後台商品管理（回頭補 CRUD） | 73 | ⬜ |
| M4 | 品類框架／體驗／SEO／分析 | 81.5 | ⬜ |
| M5 | 上線準備（含法規） | 93 | ⬜ |
| 後續 | 上線後擴充其他品類 | +2 | ⬜ |

**日曆換算**：93 為理想工作日（含 5 天產品規劃）。全職約 4–5 個月；下班/週末約半年以上。對外承諾加 20–30% 緩衝。T56（3D 素材 3 天）為素材工，若外包則不占開發時間。

> **M-1 與既有設計的關係**：產品規劃排在最前，但因資料模型與任務已先排定，這層多為「驗證並微調」而非推翻。最可能回饋的是 Wireframe（P05）配置器頁，可能微調 T16 配置器版面或 ER 細節——趁未寫程式時調整成本最低。

詳見 `MVP開發任務清單.xlsx`（任務清單＋待決策＋累積人天）。

---

## 9. 產出文件清單

- `MVP開發任務清單.xlsx` — 70 任務（含 M-1 產品規劃）、里程碑總覽、待決策（最新主檔）
- `MVP開發起步文件.md` — 技術選型／模組／資料模型／成本
- `jewelry_mvp_ER.pdf` / `jewelry_mvp_ER.mermaid` — 資料模型 ER 圖（v2，已對齊 0001/0002）
- `docs/data-model.md` — 13 張表欄位級定稿規格（T03/T46 依據）
- `supabase/migrations/0001_initial_schema.sql` — 建 13 張表（T03）
- `supabase/migrations/0002_enable_rls_and_policies.sql` — RLS 啟用與 policy（T46）
- `src/types/database.types.ts` — Supabase 生成的 13 表型別（gen types --linked）
- `docs/migration-runbook.md` — 首次 migration 套用 Runbook
- `jewelry_semicustom_flow.pdf` — 半客製流程圖
- `jewelry_system_architecture.mermaid` — 系統架構圖原始檔
- `memory.md` — 本檔
- **`CLAUDE.md`**（repo 根目錄）— 開發層施工圖：技術棧／版本策略／目錄／指令／安全紅線／工作流程（M0 新增）
- **`.claude/`**（repo 根目錄）— 6 個 hooks 護欄 + settings.json（M0 新增）
- ✅ **M-1 已產出**：競品分析（`docs/competitive-analysis.md`）、PRD（`docs/PRD.md`）、User Flow（`docs/user-flow.md`）、Brand Guide（`docs/brand-guide.md`）、**IA（`docs/IA.md`）**、**Wireframe（`docs/wireframe/`，前台 8 頁＋登入＋內容頁）**；homepage demo `incantochen-home.html`（設計定稿參考，非正式程式）
- ✅ 新增：`docs/migration-guide.md` — Supabase CLI migration 規範（命名／拆分／回滾／正式套用／seed）

---

## 10. 待辦／提醒

- ✅ **已定：DB migration 工具＝Supabase CLI**（規範見 `docs/migration-guide.md`，含命名／一支一件事／回滾／正式套用流程／seed）。
- ✅ **dev seed（T43）已完成**（2026-06-25，本機驗收通過）。⏭️ 下一步：**T15 戒指商品詳情頁 → M1 戒指可配置並付款**。
- 🔭 **模組實作時待辦**：① 過期購物車清理作業（分批、可 dry-run；T20/T21）② 個資刪除走匿名化（T63）③ 商品後台只封存不硬刪＋刪前查引用＋狀態篩選器（T10，已記入任務清單）。
- 📌 平行去辦：商業/營業登記、綠界特店申請（有審核前置時間）
- ⚖️ 上線前：條款與七天例外用詞請律師審
- 🔢 上架前才需定：戒指交期天數、各選項加價（含國際物流成本緩衝）、金屬價格管理方式
- 🔁 **同步提醒**：App Chat 專案做的新決策，記得手動抄進 repo 的 `CLAUDE.md`（Claude Code 才看得到）；memory.md 以本機 `docs/` 與 App 專案兩處保持一致。

---

## 11. M0 環境與骨架前置（已完成紀錄）

**開發環境**：Node.js 24、pnpm 11、Git 2.54、Claude Code 2.1.185（Windows，native installer）。

**專案骨架**：`pnpm create next-app` 建立 Next.js 16.2.9（TypeScript、Tailwind、ESLint、App Router、`src/`、Turbopack、import alias `@/*`），`pnpm dev` 可啟動。tsconfig 補 `noUncheckedIndexedAccess`；.gitignore 加 `.claude/.allow-migration`、`.claude/settings.local.json`。

**CLAUDE.md（repo 根目錄）**：開發層施工圖，含「目前實際狀態」（已建置 vs 尚未安裝：shadcn/Supabase/Zod/Resend/ECPay/測試框架）、技術棧鎖定、版本策略、目錄（目標結構，多數待建）、指令、資料模型核心設計、安全邊界、工作流程（逐任務、做完停下等檢核）、法規提醒。

**Hooks（`.claude/`，6 個，已驗證 `6 hooks configured`）**：
- protect-env（.env/金鑰硬擋，排除 .example）
- protect-migration（DB schema 變更擋下，需建 `.claude/.allow-migration` 放行）
- dangerous-bash（rm -rf／git push --force／DROP TABLE／supabase db reset 等硬擋）
- auto-format（寫檔後 prettier/eslint，非阻斷）
- completion-check（Stop 時跑 lint+test，無 test script 則只跑 lint）
- session-start（每次 session 注入紅線提醒）

**版控**：git init（身分 fishead / fishead02290@gmail.com，僅 local）。commit 1 `5b0594e`（root，27 檔）scaffold；commit 2 `docs: add pnpm start to CLAUDE.md`。

**注意**：測試框架（vitest）於 T51 才建，目前無 test script；Supabase/Zod 等尚未安裝，動到時先裝再用。

---

## 11.5 前端基礎建設：shadcn/ui＋品牌色票＋字體（已完成）

- **shadcn/ui 初始化**：`components.json`（style: radix-nova、baseColor: neutral、cssVariables: true）、`src/components/ui/button.tsx`、`src/lib/utils.ts`；新增元件指令 `pnpm dlx shadcn@latest add <component>`。
- **品牌色票對接**：`src/app/globals.css` 的 `@theme` 已寫入 Primary Emerald `#063B2F`、Secondary Gold `#C5A059` 完整色階（50–900），與 `docs/brand-guide.md` §4 一致；UI chrome 僅綠／金／中性，寶石色留給商品本身。
- **雙軌字體對接**：`src/app/layout.tsx` 用 `next/font/google` 載入 **EB Garamond＋Noto Serif TC**（`--font-head-latin` / `--font-head-tc`，合成 `--font-head`）與 **Hanken Grotesk＋Noto Sans TC**（`--font-body-latin` / `--font-body-tc`，合成 `--font-body`），對應 `docs/brand-guide.md` 標題／內文雙軌字體決策。已驗證 Next.js 內建 Google Fonts 字體庫含四套字體所需字重（EB Garamond 400–800＋variable；Hanken Grotesk／Noto Sans TC／Noto Serif TC 皆 100–900＋variable）。

---

## 11.6 Supabase 雲端專案對接（環境變數）

- ✅ **Supabase 雲端專案已開通**，`NEXT_PUBLIC_SUPABASE_URL`／`NEXT_PUBLIC_SUPABASE_ANON_KEY` 已由使用者本人寫入專案根目錄 `.env.local`（**Supabase 環境變數已安全配置完畢**）。
- `.env.local` 已確認列在 `.gitignore`（`.env*` 規則涵蓋），不會被 Git 追蹤或推上雲端。
- 依紅線規範，`.env*` 一律對 Claude Code 唯讀（`protect-env` hook 硬擋讀寫），本檔僅記錄狀態，不記錄金鑰實際值。
- ⏭️ 下一步可開始接 Supabase client（`src/lib/supabase`）、`supabase gen types typescript`，銜接 T03 建表進度。

---

## 12. M-1 規劃成果與新決策（incantochen）

### 12.1 品牌與定位（已定）
- **品牌名**：incantochen（incanto＝義大利文「著迷／魔法」＋ chen）。
- **客群**：30–45 歲、注重設計與質感、主導性格、喜歡小眾設計品牌；卡在「品牌珠寶太貴太張揚／一般飾品沒高級感」中間的女性。身份認同驅動——「**這件東西就是我**」才下手（非「妳值得獎勵」）；日常可戴、彩色寶石為主角。
- **定位**：填補上述價格／質感缺口；quiet luxury、自助、即時報價、透明、不被推銷。
- **價位帶**：NT$20,000–50,000／件。
- **MVP 成功指標**：① **完整閉環**（端到端下單成功，先求跑通、不看量）② **配置器漏斗轉換**（進入→選配完成→加購）。量化門檻待有 baseline 再設。

### 12.2 產品結構（已定）
- **全產品線**：戒指／耳環／手鍊／項鍊（MVP 戒指起步，其他靠後台擴充）。
- **半客製選配選項（依品類；數量為共通）**：
  - 戒指：寶石顏色／金屬色／戒圍
  - 耳環：寶石顏色／金屬色／耳針或耳夾
  - 手鍊：寶石顏色／金屬色／長度
  - 項鍊：寶石顏色／金屬色／長度
- **兩種模式**：半客製（自助、即時報價、標準結帳，全品類）；全客製＝**預約訂製**（MVP 只做預約／詢問表單＋通知店家＋人工後續；完整報價→確認書→鎖價→製作為 Phase 3）。

### 12.3 視覺與品牌規範（Brand Guide v2 → `docs/brand-guide.md`）
- **色彩**：Primary Emerald `#063B2F`、Secondary Gold `#C5A059`、Paper `#FAF9F6`、Ink `#1A1A1A`（藏藍 `#1A2B3C` 為一行可換備案）。**寶石色只出現在商品本身，UI chrome 僅綠／金／中性**。
- **字型（雙軌）**：標題 **EB Garamond＋Noto Serif TC**（serif）；內文 **Hanken Grotesk＋Noto Sans TC**（sans）。（修正早期「純 sans」之決定。）
- **元件**：按鈕編輯感（大寫、寬字距、方角 `2px`）；卡片／輸入框柔角 `11px`；導覽置中大寫；hero 滿版深色＋左側 `explore collection` 直書＋圓形下滑鈕。
- **文案語氣**：身份認同（「選妳的顏色／這就是妳」），非獎勵敘事。
- 已有 homepage demo 驗證上述 token；⏳ 待製 logo／favicon／OG。

### 12.4 動線決策（User Flow v2 → `docs/user-flow.md`）

**配置器入口**：於**商品詳情頁內展開**（非獨立配置頁）。

**Flow 1 付款（重要）**
- 判定**以背景 Webhook 為準**；成功頁先顯示「確認付款中…」Loading。
- **主動對帳納入 MVP**：等待時後台主動呼叫綠界「**訂單查詢 API**」取權威狀態（冪等更新），數秒內給明確結果（高端體驗：快、不讓客戶失去信任）。
- **三態**：已確認成功／已確認失敗／**尚未確認**。逾時 ≠ 失敗，**不可顯示「失敗請重試」**（很可能已付款，重試會雙重扣款）；極少數退到「款項確認中，email 通知」。
- 失敗/中斷 → 訂單留「待付款」；重試需**換新 MerchantTradeNo、掛同一張內部訂單**；**重付前先檢查是否已付款**（防雙重扣款）；重試做**速率限制＋軟上限**（非無限重試，防盜刷測試連累金流帳號）。
- **MVP 政策**：待付款訂單**不自動取消、不寄未完成提醒**（Phase 2 再加）。

**Flow 2 登入（重要）**
- **主推 Email OTP 驗證碼、magic link 為輔**；連結落地頁須**再按一次「登入」才消耗 token**（防 Outlook SafeLinks／防毒／預覽 bot 先 GET 把單次連結用掉）。
- session 落在**輸碼／點擊的當下裝置**（**不綁同裝置**，解跨裝置：手機輸入→桌機收信也不卡）；token 高熵／雜湊／單次／短效（15–60 分）；失效→**一鍵重寄**。
- 跨裝置自動接力 → Phase 2（有 OTP 通常不需要）。

**Flow 4 全客製預約**：MVP＝預約／詢問表單（品項／預算／想法／聯絡方式）＋通知店家＋人工後續。

**Flow 3 售後**：入口**僅從訂單發起**＋設**售後說明頁**。**19 項待確認**（見 user-flow §3.1），高風險先鎖：A（**半客製是否算法定客製品**，決定七天適用與否，**須律師**）、C（**已開電子發票退款須折讓／作廢**、客製品退款比例、綠界刷退時效等會計／金流合規）。

### 12.5 IA／Wireframe 決策（P04／P05 → `docs/IA.md`、`docs/wireframe/`）
- **路由**：PDP＝`/products/[slug]`（與品類解耦，一商品一正規網址、利 SEO）；品類＝`/collections/[category]`（戒指起步，其餘品類後台上架自動點亮）；配置器**內嵌 PDP，無 `/configure` 獨立路由**。
- **會員中心範圍**：訂單列表／詳情＋個資（Email／姓名）＋售後入口；**不做收件人通訊錄／偏好**（ER 為 Order 內嵌收件、無地址表）——列 Phase 2。
- **搜尋**：MVP 無全文搜尋，icon 暫指向目錄；**全文搜尋 Phase 2**。
- **預約表單最小集**：品項／預算帶／想法／參考圖（選填）／聯絡方式（Email 必填）。
- **PDP 影像**：主圖（選配後合成圖·即時換）＋2–3 張配戴／生活情境圖穿插。
- **內容頁**（戒圍量法／售後說明／條款／隱私）為輕量版型，⚖️ 法律文字律師審；後台 `/admin/*` 留至 M2/M3。

### 12.6 仍待辦／提醒
- ✅ **DB migration 工具已定：Supabase CLI**（見 `docs/migration-guide.md`）。
- ⚖️ **Flow 3 售後 19 項待確認**（律師＋會計合規），尤其 A、C 類。
- 🎨 待製：logo／favicon／OG、3D 合成商品圖。
- ✅ **dev seed（T43）已完成並驗收通過**（2026-06-25）。⏭️ **下一步**：T15 戒指商品詳情頁 → M1。
