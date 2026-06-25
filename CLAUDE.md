# CLAUDE.md — incantochen（高端半客製彩色寶石電商）

> 文件更新日期：2026-06-25

> 給 Claude Code 的專案施工圖。每次對話開始自動載入。
> 規劃文件（含 memory、任務清單）放在 `docs/`；本檔是「開發層」的對齊版本。
> 維護原則：保持精簡（目標 < 200 行）、規則具體可驗證、過時就刪。
> 📁 **文件目錄**：所有文件位置與用途見 [`docs/docs-index.md`](docs/docs-index.md)
> 📋 **工作日誌**：本次／下次作業記錄見 [`docs/work-log.md`](docs/work-log.md)

> **目前實際狀態（隨開發更新）：** 已建立 Next.js 16.2.9 骨架（TypeScript、Tailwind、ESLint、App Router、`src/`、Turbopack、`@/*`），`pnpm dev` 可啟動。
> ✅ **shadcn/ui 已初始化**（`components.json`、`src/components/ui/button.tsx`、`src/lib/utils.ts`）；**品牌色票**（Primary Emerald `#063B2F`、Secondary Gold `#C5A059`、中性色階）已寫入 `globals.css` 的 `@theme`，與 `docs/brand-guide.md` 一致；**雙軌字體已對接**：標題 `--font-head`＝EB Garamond＋Noto Serif TC，內文 `--font-body`＝Hanken Grotesk＋Noto Sans TC（`src/app/layout.tsx` 用 `next/font/google` 載入，已驗證字重支援）。
> ⚠️ **下列技術棧雖已鎖定，但尚未安裝**：Supabase（client 與 CLI）、Zod、Resend、ECPay 串接、測試框架。動到它們時先安裝再使用，不要假設已存在、也不要憑空 import。
> ✅ **資料庫 schema 已套用至雲端 production**（project-ref `wdmigbqdhernmrfpzzxk`）：`0001`（13 張表）＋`0002`（11 條 RLS policy）已 `db push`、雲端驗收通過；型別已生於 `src/types/database.types.ts`；commit `c124482`。後續改 schema 一律**新增** migration（已套用的不可改）。
> ✅ **T43 dev seed 已完成，本機＋雲端 production 皆已套用（2026-06-25）**：`supabase/seed.sql`（1 款戒指＋3 OptionType＋8 OptionValue＋白名單）；`supabase db reset --local` 套用＋逐條查詢驗收全數通過（見 §7）。修正一處 bug：`option_type` 無 `sort_order` 欄位，seed.sql／verify-seed.sql 已移除該欄位引用。⚠️ **重要環境提醒**：`.env.local` 的 `NEXT_PUBLIC_SUPABASE_URL` 指向**雲端 production**（`wdmigbqdhernmrfpzzxk`），不是本機 `127.0.0.1:54321`——`pnpm dev` 實際打的是雲端資料庫，本機 `supabase db reset --local` 的資料只影響本機 stack，看不到。因此 seed 也已用 `supabase db query --linked --file supabase/seed.sql` 額外套用到雲端（seed.sql 本身用固定 UUID＋`ON CONFLICT DO NOTHING`，對任一端重複執行皆安全）。之後若改 seed 或加測試資料，兩邊都要各跑一次才會在 `pnpm dev` 看到。
> ✅ **T04 部署到 Vercel＋CI 已完成（2026-06-25）**：repo 已 push 至 GitHub（`github.com/incantochen/incantochen`）並透過 Vercel GitHub App 連接專案 `jewelry-shop`；Supabase 環境變數已於 Vercel Dashboard 設定（Production/Preview/Development）；首次部署成功，production 網址 `https://jewelry-shop-delta.vercel.app`；已用空 commit push 驗證 CI 自動部署生效（push 後自動觸發新 production 部署）。
> ✅ **T52 Staging 環境已完成（2026-06-25）**：`staging` 分支 push 後 Vercel 自動產生 Preview 部署（非 Production），穩定分支別名 `https://jewelry-shop-git-staging-fishead02290-3279s-projects.vercel.app`，供日後 ECPay sandbox 等金流測試使用。
> ✅ **T05 Supabase Auth（Email OTP＋magic link）本機設定已完成（2026-06-25）**：`supabase/config.toml` 補上 `additional_redirect_urls` 萬用路徑、`[auth.email.template.magic_link]`；新增 `supabase/templates/magic_link.html`（顯示 6 碼 OTP＋指向自家 `/auth/confirm` 的連結，而非 Supabase 預設驗證端點）。本機 `signInWithOtp`→Mailpit 收信→`verify` 端到端測試通過。**production 設定待使用者手動到 Supabase Dashboard 配置**（見 `docs/work-log.md` T05 待辦），`/auth/confirm` 頁面本身留給 T06／T07。
> ✅ **T15 戒指商品詳情頁骨架已完成（2026-06-25）**：`src/app/products/[slug]/page.tsx`（Server Component，從 Supabase 撈商品＋三層白名單並靜態呈現，找不到走 `notFound()`）；新增共用 `SiteHeader`／`SiteFooter` 並接進 `src/app/layout.tsx`。**範圍刻意不含**：配置器互動／即時換圖／即時計價／加入購物袋邏輯（T16–T20）、「關於這件作品」與「猜你喜歡」區塊（schema 無描述欄位、seed 僅 1 款商品，故未做）。Playwright 視覺驗證通過（正常 slug 顯示完整骨架、假 slug 正確 404、無 console error）。

---

## 1. 專案概覽

- **產品**：**incantochen** — 高端半客製彩色寶石飾品電商。MVP 做「半客製」——標準款 + 客人選配，價格選配當下即時計算，走標準電商結帳。**全品類**：戒指／耳環／手鍊／項鍊。
- **全客製**（報價→確認書→鎖價）為 Phase 3，**MVP 僅做預約／詢問表單**。
- **核心策略**：單人開發、骨架優先、**戒指起步**，其他品類（耳環／項鍊／手鍊）日後靠後台自行擴充。
- **目前階段**：M-1 規劃**全數完成**；M0 全數完成（T01–T05、T43、T46、T52）。M1 已開工：T15 戒指商品詳情頁骨架完成。下一步：**T16 配置器 UI（互動）**。里程碑序列：M0 → M1 戒指可配置並付款 → M2 → M3 → M4 → M5。

---

## 2. 技術棧（已鎖定，勿擅自更換）

| 層 | 選用 |
|---|---|
| 前端 | **Next.js 16**（App Router）＋ shadcn/ui ＋ Tailwind CSS |
| 函式庫 | **React 19.2**（隨 Next.js 16，勿單獨變更版本） |
| 語言 | **TypeScript**（strict） |
| 套件管理器 | **pnpm**（鎖定，勿混用 npm／yarn；lockfile 進 git） |
| Runtime | **Node.js 20+**（Next.js 16 最低需求） |
| 部署 | Vercel（含 CI、preview 為 staging） |
| 資料庫／後端 | Supabase（Postgres） |
| 會員登入 | Supabase Auth — **Email OTP 驗證碼（主）＋ Magic link（輔）**，免密碼 |
| 圖片儲存 | Supabase Storage |
| 金流／電子發票 | 綠界 ECPay |
| 物流 | 綠界黑貓宅配（保價＋本人簽收，**不開放超商**） |
| Email | Resend |
| 驗證 | Zod（所有外部輸入；以 `z.infer` 推導型別） |
| DB migration | **Supabase CLI**（SQL 於 `supabase/migrations/`；**勿引 ORM 管 migration**） |

**Next.js 16 注意事項：**
- Turbopack 為預設打包器；快取改為明確的 Cache Components（opt-in），預設動態渲染——電商的價格／庫存／訂單本來就該即時，符合需求。
- 路由攔截已從 `middleware.js` 改為 **`proxy.ts`**（用於 magic link 授權的進入點寫在這裡）。
- 商品組合圖採「程式合成」：Blender 3D 素材 + 前端擬真疊圖（對齊＋陰影高光）。**MVP 不做 3D 即時預覽**。

**TypeScript 設定基線：**
- `tsconfig.json` 啟用 `strict: true`，並額外開 **`noUncheckedIndexedAccess: true`**（金流／電商必備，強制處理取值可能為 undefined）。
- 路徑別名 `@/*` → `./src/*`。
- **Supabase 型別自動生成**：每次改 schema 後跑 `supabase gen types typescript`，產出 13 張表的型別，查詢要有端到端型別安全。
- 環境變數集中於有型別的 env 模組，不在各處散用 `process.env.XXX`。

**版本策略：**
- 只用穩定版（Stable）。安裝套件用明確版本或 `@latest`，**禁用 `@canary`／`@beta`／`@rc`／`@next`**。
- 不主動升級相依套件；除非我要求，或為修補安全漏洞。以 lockfile 為準，保持版本一致。
- 主版本升級（如 Next.js 16 → 17）或更換任何已鎖定的技術棧，**先進 plan mode 提出 Migration Plan（影響範圍／breaking changes／回滾方式），經我確認再執行**。

---

## 3. 目錄結構

> 採 `--src-dir`，程式碼放 `src/` 底下。
> **以下為目標結構：目前只有 `src/app` 存在，其餘目錄由 Claude Code 做到對應任務時才建立。請依 repo 實際情況修正本節。**

- `src/app` — 頁面與 route（含 API route handlers）；✅ `products/[slug]/page.tsx`（T15，PDP 骨架）
- `src/proxy.ts` — 路由攔截／授權進入點（Next.js 16，取代舊 `middleware.js`）
- `src/components` — ✅ `site-header.tsx`／`site-footer.tsx`（T15，全站共用，已接進 `src/app/layout.tsx`）
- `src/components/ui` — shadcn/ui 元件（✅ 已初始化，目前有 `button.tsx`；新增用 `pnpm dlx shadcn@latest add <component>`）
- `src/lib` — 工具函式、Supabase client、報價引擎、ECPay 串接（✅ `utils.ts` 已建立，shadcn 用）
- `src/lib/quote` — 報價引擎（選配加價計算），**伺服器端為準**
- `src/lib/env.ts` — 集中、有型別的環境變數
- `src/types` — 共用型別與 Zod schema（含 Supabase 生成型別）；`database.types.ts`（✅ 已生成，13 表型別）
- `supabase/` — migration SQL（✅ 已有 `0001`、`0002`）、`seed.sql`（✅ T43 已產出）
- `docs/` — 所有規劃與規範文件（見 `docs/docs-index.md`）
- `public/brand/` — 品牌素材：logo、favicon、3D 合成商品圖、OG/social 圖（⏳ 待產出）

**路由（IA 定案）**：PDP `/products/[slug]`、品類 `/collections/[category]`、配置器內嵌 PDP（**無獨立 config route**）、**全文搜尋 Phase 2**；後台 `/admin/*` 留至 M2/M3。

新增檔案前先確認該模組既有位置，沿用現有命名與結構，不要另立風格。
**做任何 UI／頁面前，先讀 `docs/brand-guide.md`、對應的 `docs/user-flow.md` 與該頁 wireframe；若該檔尚未產出，先停下提醒我補。品牌 token 以 `tailwind.config` / shadcn theme 為準，不要每頁自行挑色。**

---

## 4. 常用指令

- 安裝相依：`pnpm install`
- 啟動開發：`pnpm dev`
- 建置：`pnpm build`
- 測試：`pnpm test`（⚠️ 測試框架於 T51 才建置，目前**尚無 test script**；屆時建議用 vitest）
- Lint／格式化：`pnpm lint`（已可用）
- 加 shadcn/ui 元件：`pnpm dlx shadcn@latest add <component>`
- 生成 Supabase 型別：`pnpm supabase gen types typescript`（改 schema 後執行）
- **seed 套用**：`supabase db reset --local`（reset 並自動套用 `seed.sql`；此 CLI 版本〔2.107.0〕無獨立 `db seed` 子指令）
- **一律用 pnpm，不要混用 npm／yarn**

**Windows 環境限制（搜尋指令）：**
- **禁止**從根目錄做全硬碟搜尋（`find /`、`dir /s C:\`、`Get-ChildItem -Recurse` 等）——會掃到 `node_modules`，極慢且可能掛起。
- 一律改用限制深度的相對路徑搜尋，例如 `find . -maxdepth 3 -name "*.ts"`。

---

## 5. 資料模型（13 張表，勿隨意增刪表）

- **商品與選項**：Product、OptionType、OptionValue、ProductOption、ProductOptionValue
- **會員與購物車**：Member、Cart、CartItem
- **訂單與金流**：Order、OrderItem、Payment
- **通知與狀態**：OrderStatusLog、Notification

三個核心設計，改動相關程式前務必遵守：

1. **資料驅動配置器**：選項由資料決定，三層控制——類別 `applies_to` → 款式 `ProductOption` → 值白名單 `ProductOptionValue`。**白名單必留**，前端不得繞過。**配置器於商品詳情頁內展開（非獨立頁）**，故無獨立 config route。
2. **快照欄位**：`CartItem` / `OrderItem` 存 `unit_price_snapshot` + `config_snapshot`(JSON)。下單當下釘住價格與規格，**後台日後調價不得影響已成立訂單**。
3. **Order 內嵌收件與物流**：MVP 不另開地址表／工單表，`tracking_no` 由人工填寫。

欄位級定案詳見 `docs/data-model.md`；外鍵策略：帳務鏈 RESTRICT、設定圖與暫態 CASCADE；`orders` 為保留字避免的實體表名。

---

## 6. 安全邊界（電商，最高優先）

**兩條紅線，永遠不可省：**
- **伺服器端驗價（T41）**：金額一律在伺服器端依白名單重新計算，**絕不信任前端傳來的價格**。
- **資料庫備份（T34）**：備份相關設定不可關閉或繞過。

**其他硬性規則：**
- ✅ **RLS（T46 已完成）**：13 表全 enable、deny-by-default。商品/選項公開唯讀且限 `status='active'`；帳務表禁硬刪；後台 admin 走 service role。
- **卡號不落地**：信用卡資訊全程交給綠界。
- **金流冪等**：Webhook＋主動對帳 API 共用冪等鎖；逾時 ≠ 失敗；重付前先查是否已付款。
- **登入防護**：magic link 落地頁需使用者再按一次才消耗 token；token 高熵／單次／短效。

**未經明確同意，不得：** 修改 `.env*`、執行 DB migration、改動 auth／金流／session 邏輯、變更 RLS policy 或 CI 設定。

**Hook 強制護欄（`.claude/`）：** protect-env / protect-migration / dangerous-bash / completion-check / auto-format / session-start。

---

## 7. 工作流程要求

- **逐任務進行**：一次專注一個任務，開始前先說明計畫。
- **涉及 auth／金流／session／migration 的任務一律先進 plan mode**，等確認再動手。
- **完成檢核**：實作 → 自行驗收（見下方各任務驗收指令）→ 跑 lint → dev 確認無錯誤 → 才算完成。
- **完成後停下回報**：列出改了什麼、產出什麼、驗收結果，**等確認後再進下一個任務**。
- **commit 規範**：Conventional Commits（`feat:`、`fix:`、`chore:`）。一個任務一支 commit。
- **不確定就問**：規格、定價邏輯、法規用詞有疑慮時先問，不要自行假設。

### 各任務自驗收指令

#### T43 dev seed ✅ 已完成（2026-06-25）
完成 `supabase db reset --local` 後，逐條執行 `docs/verify-seed.sql` 的查詢驗收（此 CLI 版本 `db query` 不支援單檔多語句，需逐條跑，或用 `supabase db query --local "<sql>"`；自訂 enum 欄位查詢需 `::text` 轉型，否則無法掃描）。

**通過條件**（§1 筆數查詢結果）：
- `products = 1`
- `option_types = 3`
- `option_values = 8`
- `product_options = 3`
- `product_option_values = 8`

§4 白名單查詢須出現 8 列，且 `gem_color/emerald`、`metal_color/18k-yellow`、`ring_size/size-10` 的 `is_default = true`；§5 完整性查詢全部為 `true`。

**結果：全部通過。** 下一步：T15 戒指商品詳情頁。

---

## 8. 法規與營運提醒（開發時注意，非程式工作）

- **七天鑑賞期**：客製品主張法定例外，但須結帳告知同意（T57）＋條款載明（T36）。**用詞以律師審定版為準，勿自行擬定。**
- **退款**：客製品限瑕疵／錯誤可退，走綠界退刷。
- **交期告知**：商品頁／結帳／說明頁標示「下單後訂製、交期至少 XX 天」。
- 隱私權政策（T36）、個資刪除走匿名化（T63）為上線必備。
- **售後**：多項待確認（**半客製是否算法定客製品**、退款比例、已開電子發票退款須折讓／作廢），**須律師＋會計確認**，見 `docs/user-flow.md §3.1`。
