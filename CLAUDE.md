# CLAUDE.md — incantochen（高端半客製彩色寶石電商）

> 給 Claude Code 的專案施工圖。每次對話開始自動載入。
> 規劃文件（含 memory、任務清單）放在 `docs/`；本檔是「開發層」的對齊版本。
> 維護原則：保持精簡（目標 < 200 行）、規則具體可驗證、過時就刪。

> **目前實際狀態（隨開發更新）：** 已建立 Next.js 16.2.9 骨架（TypeScript、Tailwind、ESLint、App Router、`src/`、Turbopack、`@/*`），`pnpm dev` 可啟動。
> ✅ **shadcn/ui 已初始化**（`components.json`、`src/components/ui/button.tsx`、`src/lib/utils.ts`）；**品牌色票**（Primary Emerald `#063B2F`、Secondary Gold `#C5A059`、中性色階）已寫入 `globals.css` 的 `@theme`，與 `docs/brand-guide.md` 一致；**雙軌字體已對接**：標題 `--font-head`＝EB Garamond＋Noto Serif TC，內文 `--font-body`＝Hanken Grotesk＋Noto Sans TC（`src/app/layout.tsx` 用 `next/font/google` 載入，已驗證字重支援）。
> ⚠️ **下列技術棧雖已鎖定，但尚未安裝**：Supabase（client 與 CLI）、Zod、Resend、ECPay 串接、測試框架。動到它們時先安裝再使用，不要假設已存在、也不要憑空 import。

---

## 1. 專案概覽

- **產品**：**incantochen** — 高端半客製彩色寶石飾品電商。MVP 做「半客製」——標準款 + 客人選配，價格選配當下即時計算，走標準電商結帳。**全品類**：戒指／耳環／手鍊／項鍊。
- **全客製**（報價→確認書→鎖價）為 Phase 3，**MVP 僅做預約／詢問表單**。
- **核心策略**：單人開發、骨架優先、**戒指起步**，其他品類（耳環／項鍊／手鍊）日後靠後台自行擴充。
- **目前階段**：M-1 規劃**全數完成**（競品／PRD／User Flow／Brand Guide／IA／Wireframe）。下一步進 M1/M0 開發：**T03 依 ER 分 4 組建 13 張表 → T46 RLS → dev seed**。里程碑序列：M0 環境骨架 → M1 戒指可配置並付款 → M2 訂單營運閉環 → M3 後台商品 CRUD → M4 品類框架／SEO／分析 → M5 上線（含法規）。

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

- `src/app` — 頁面與 route（含 API route handlers）
- `src/proxy.ts` — 路由攔截／授權進入點（Next.js 16，取代舊 `middleware.js`）
- `src/components/ui` — shadcn/ui 元件（✅ 已初始化，目前有 `button.tsx`；新增用 `pnpm dlx shadcn@latest add <component>`）
- `src/lib` — 工具函式、Supabase client、報價引擎、ECPay 串接（✅ `utils.ts` 已建立，shadcn 用）
- `src/lib/quote` — 報價引擎（選配加價計算），**伺服器端為準**
- `src/lib/env.ts` — 集中、有型別的環境變數
- `src/types` — 共用型別與 Zod schema（含 Supabase 生成型別）
- `supabase/` — migration SQL、RLS policy、種子資料
- `docs/competitive-analysis.md` — 競品分析（✅ 已產出，M-1）
- `docs/PRD.md` — 產品需求文件（✅ 已產出，M-1）
- `docs/user-flow.md` — 半客製購物動線（✅ 已產出，M-1）
- `docs/IA.md` — 資訊架構：網站地圖／導覽／URL 路由（✅ 已產出，M-1）
- `docs/wireframe/` — 各頁面線框，含核心的配置器頁 T16（✅ 已產出，M-1）
- `docs/brand-guide.md` — 品牌 UI 規範：色彩／字體／間距／元件基調／文案語氣（✅ 已產出，M-1）
- `docs/migration-guide.md` — Supabase CLI migration 規範（✅ 已產出）
- `public/brand/` — 品牌素材：logo、favicon、3D 合成商品圖、OG/social 圖（⏳ 待產出）

**路由（IA 定案）**：PDP `/products/[slug]`、品類 `/collections/[category]`、配置器內嵌 PDP（**無獨立 config route**）、會員中心**不做通訊錄**、**全文搜尋 Phase 2**（icon 暫指目錄）；後台 `/admin/*` 留至 M2/M3。

新增檔案前先確認該模組既有位置，沿用現有命名與結構，不要另立風格。
**做任何 UI／頁面前，先讀 `docs/brand-guide.md`、對應的 `docs/user-flow.md` 與該頁 wireframe；若該檔尚未產出，先停下提醒我補。品牌 token 以 `tailwind.config` / shadcn theme 為準，不要每頁自行挑色。**

---

## 4. 常用指令

- 安裝相依：`pnpm install`
- 啟動開發：`pnpm dev`
- 建置：`pnpm build`
- 測試：`pnpm test`（⚠️ 測試框架於 T51 才建置，目前**尚無 test script**；屆時建議用 vitest。報價引擎等核心邏輯必須有單元測試）
- Lint／格式化：`pnpm lint`（已可用）
- 加 shadcn/ui 元件：`pnpm dlx shadcn@latest add <component>`
- 生成 Supabase 型別：`pnpm supabase gen types typescript`（改 schema 後執行）
- **一律用 pnpm，不要混用 npm／yarn**；改完任何功能後至少跑 lint + 相關測試才算完成（見第 7 節）。

**Windows 環境限制（搜尋指令）：**
- **禁止**使用 `find /`、`dir /s C:\`、`Get-ChildItem -Recurse` 從根目錄等**全硬碟／全目錄樹搜尋**指令——在 Windows 下會掃到 `node_modules`、系統目錄，極慢且可能掛起。
- 一律改用**限制深度的相對路徑搜尋**，例如 `find . -maxdepth 3 -name "*.ts"`；優先使用內建的 Glob／Grep 工具而非 shell 搜尋指令。

---

## 5. 資料模型（13 張表，勿隨意增刪表）

- **商品與選項**：Product、OptionType、OptionValue、ProductOption、ProductOptionValue
- **會員與購物車**：Member、Cart、CartItem
- **訂單與金流**：Order、OrderItem、Payment
- **通知與狀態**：OrderStatusLog、Notification

三個核心設計，改動相關程式前務必遵守：

1. **資料驅動配置器**：選項由資料決定，三層控制——類別 `applies_to` → 款式 `ProductOption` → 值白名單 `ProductOptionValue`。**白名單必留**，前端不得繞過。選配選項依品類：戒指＝寶石顏色／金屬色／戒圍；耳環＝寶石顏色／金屬色／耳針或耳夾；手鍊・項鍊＝寶石顏色／金屬色／長度（數量為共通）。**配置器於商品詳情頁內展開（非獨立頁）**，故無獨立 config route。
2. **快照欄位**：`CartItem` / `OrderItem` 存 `unit_price_snapshot` + `config_snapshot`(JSON)。下單當下釘住價格與規格，**後台日後調價不得影響已成立訂單**。
3. **Order 內嵌收件與物流**：MVP 不另開地址表／工單表，`tracking_no` 由人工填寫。

---

## 6. 安全邊界（電商，最高優先）

**兩條紅線，永遠不可省：**
- **伺服器端驗價（T41）**：金額一律在伺服器端依白名單重新計算，**絕不信任前端傳來的價格**。前端價格僅供顯示。
- **資料庫備份（T34）**：備份相關設定不可關閉或繞過。

**其他硬性規則：**
- **RLS（T46）**：會員只能讀自己的訂單；商品／選項為公開唯讀；所有寫入走後端，不可從前端直接寫敏感資料。
- **卡號不落地**：信用卡資訊全程交給綠界，系統不儲存、不轉傳卡號。
- **最小化蒐集**：不蒐集身分證號、銀行帳號等高敏個資（發票與退款由綠界處理）。**因此不做欄位級加密**——勿自行加上。
- **應用層防護（T58）**：SQL 注入防護、所有外部輸入用 Zod 驗證、設定安全標頭、防 XSS、magic link 防濫發。
- **框架安全版本**：Next.js 16.x 曾有多個 middleware/proxy 授權繞過漏洞——務必跑在最新修補版（定期 `pnpm update next`）。授權判斷不可只依賴 `proxy.ts`；後端 API 與 RLS 需各自獨立驗證，不假設請求已通過攔截。
- **後台 PII（T64）**：個資需遮罩，存取需稽核記錄。
- **Migration（規範見 `docs/migration-guide.md`）**：用 Supabase CLI；**已套用的 migration 不可改、只加新支**；正式環境套用前**確認備份可用（紅線 T34）**；`supabase db reset` 僅限 local；改完 schema 跑 `supabase gen types typescript`。
- **金流回拋與冪等（重要）**：付款判定**以綠界背景 Webhook 為準**；成功頁顯示「確認付款中」，後台**主動呼叫綠界訂單查詢 API 對帳（MVP）**。Webhook 與查詢**共用同一套對帳邏輯＋冪等鎖**，狀態只前進一次；兩者回應皆須**驗 CheckMacValue**。**重付前先檢查訂單是否已付款**（防雙重扣款）；重試需**換新 MerchantTradeNo、掛同一張內部訂單**，並對重試做**速率限制＋軟上限**。**逾時 ≠ 失敗**：只有綠界明確回報失敗才顯示可重試；待付款訂單 MVP 不自動取消、不寄提醒。
- **登入（OTP＋magic link）**：Email OTP 驗證碼為主、magic link 為輔；**連結落地頁須使用者再按一次「登入」才消耗 token**（防 email 安全掃描器先 GET 把單次連結用掉）；session 落在當下裝置（**不綁同裝置**）；token 高熵／雜湊／單次／短效（15–60 分）；防濫發（T58）。

**未經我明確同意，不得進行的操作：**
- 修改 `.env*`、金鑰、token（一律當唯讀；需要新環境變數時先告知我）
- 執行或撰寫資料庫 migration（改 schema 前先進 plan mode 給我看）
- 改動登入（magic link）、金流（ECPay）、session 相關邏輯——一律先進 plan mode
- 變更 RLS policy、Vercel／Supabase 設定、CI 設定

**已由 hook 強制的紅線（`.claude/`，非僅建議）：**
- `.env*`／金鑰檔的讀寫 → 硬擋（`protect-env`）
- DB schema／migration 變更 → 擋下，需經我建立 `.claude/.allow-migration` 放行（`protect-migration`）
- `rm -rf`、`git push --force`、`DROP TABLE`、`supabase db reset` 等毀滅性指令 → 硬擋（`dangerous-bash`）
- 收工前自動跑 `pnpm lint` + `pnpm test`，未過不得結束任務（`completion-check`）
- 寫檔後自動格式化（`auto-format`）；每次 session 自動注入本紅線提醒（`session-start`）
> 這些是程式層級的強制護欄；其餘規則仍以本檔文字為準，兩者搭配。

---

## 7. 工作流程要求

- **逐任務進行**：以任務清單（T01、T02…）為單位。一次專注一個任務，開始前先說明你的計畫。
- **涉及 auth／金流／session／migration 的任務一律先進 plan mode**，等我確認再動手。
- **完成檢核**（每個功能任務都要走完）：實作 → 跑相關測試 → 跑 lint → 啟動 dev 確認無錯誤 → 才算完成。
- **完成後停下回報**：列出你改了什麼、產出什麼、是否通過檢核，**等我檢核確認後再進下一個任務**，不要自己連續往下做。
- **commit 規範**：採 Conventional Commits（如 `feat:`、`fix:`、`chore:`）。一個任務一次有意義的 commit。
- **不確定就問**：規格、定價邏輯、法規用詞有疑慮時，先問我，不要自行假設。

---

## 8. 法規與營運提醒（開發時注意，非程式工作）

- **七天鑑賞期**：標準品適用；客製品主張法定例外，但須結帳時告知並取得同意（T57）＋條款載明（T36）。**相關用詞以律師審定版為準，勿自行擬定法律文字。**
- **退款**：客製品限瑕疵／錯誤可退，走綠界金流退刷。
- **交期告知**：不擋庫存，以「下單後訂製、交期至少 XX 天」於商品頁／結帳／說明頁標示。
- 隱私權政策（T36）、當事人個資權利處理流程（T63）為上線必備。
- **售後**：入口僅從訂單發起＋售後說明頁；多項待確認（**半客製是否算法定客製品**、退款比例等，見 `docs/user-flow.md` §3.1），**須律師＋會計確認**。**已開電子發票退款須開折讓單／作廢發票**（財政部規定）。
