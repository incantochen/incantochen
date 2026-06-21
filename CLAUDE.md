# CLAUDE.md — 高端客製化珠寶電商

> 給 Claude Code 的專案施工圖。每次對話開始自動載入。
> 規劃文件（含 memory、任務清單）放在 `docs/`；本檔是「開發層」的對齊版本。
> 維護原則：保持精簡（目標 < 200 行）、規則具體可驗證、過時就刪。

> **目前實際狀態（隨開發更新）：** 已建立 Next.js 16.2.9 骨架（TypeScript、Tailwind、ESLint、App Router、`src/`、Turbopack、`@/*`），`pnpm dev` 可啟動。
> ⚠️ **下列技術棧雖已鎖定，但尚未安裝**：shadcn/ui、Supabase（client 與 CLI）、Zod、Resend、ECPay 串接、測試框架。動到它們時先安裝再使用，不要假設已存在、也不要憑空 import。

---

## 1. 專案概覽

- **產品**：高端客製化寶石飾品電商。MVP 只做「半客製」——標準款 + 客人選配（寶石／金屬色／尺寸／數量），價格選配當下即時計算，走標準電商結帳。
- **全客製**（報價→確認書→鎖價）為 Phase 3，**MVP 不做**。
- **核心策略**：單人開發、骨架優先、**戒指起步**，其他品類（耳環／項鍊／手鍊）日後靠後台自行擴充。
- **目前階段**：M0（環境與骨架前置）。里程碑序列：M0 環境骨架 → M1 戒指可配置並付款 → M2 訂單營運閉環 → M3 後台商品 CRUD → M4 品類框架／SEO／分析 → M5 上線（含法規）。

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
| 會員登入 | Supabase Auth — **Magic link（免密碼）** |
| 圖片儲存 | Supabase Storage |
| 金流／電子發票 | 綠界 ECPay |
| 物流 | 綠界黑貓宅配（保價＋本人簽收，**不開放超商**） |
| Email | Resend |
| 驗證 | Zod（所有外部輸入；以 `z.infer` 推導型別） |

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
- `src/components` — 共用 UI 元件（含 shadcn/ui）
- `src/lib` — 工具函式、Supabase client、報價引擎、ECPay 串接
- `src/lib/quote` — 報價引擎（選配加價計算），**伺服器端為準**
- `src/lib/env.ts` — 集中、有型別的環境變數
- `src/types` — 共用型別與 Zod schema（含 Supabase 生成型別）
- `supabase/` — migration SQL、RLS policy、種子資料
- `docs/user-flow.md` — 半客製購物動線（⏳ 待產出，M-1）
- `docs/wireframe/` — 各頁面線框，含核心的配置器頁 T16（⏳ 待產出，M-1）
- `docs/brand-guide.md` — 品牌 UI 規範：色彩／字體／間距／元件基調／文案語氣（⏳ 待產出，M-1）
- `public/brand/` — 品牌素材：logo、favicon、3D 合成商品圖、OG/social 圖（⏳ 待產出）

新增檔案前先確認該模組既有位置，沿用現有命名與結構，不要另立風格。
**做任何 UI／頁面前，先讀 `docs/brand-guide.md`、對應的 `docs/user-flow.md` 與該頁 wireframe；若該檔尚未產出，先停下提醒我補。品牌 token 以 `tailwind.config` / shadcn theme 為準，不要每頁自行挑色。**

---

## 4. 常用指令

- 安裝相依：`pnpm install`
- 啟動開發：`pnpm dev`
- 建置：`pnpm build`
- 正式啟動：`pnpm start`（production，需先 build）
- 測試：`pnpm test`（⚠️ 測試框架於 T51 才建置，目前**尚無 test script**；屆時建議用 vitest。報價引擎等核心邏輯必須有單元測試）
- Lint／格式化：`pnpm lint`（已可用）
- 加 shadcn/ui 元件：`pnpm dlx shadcn@latest add <component>`
- 生成 Supabase 型別：`pnpm supabase gen types typescript`（改 schema 後執行）
- **一律用 pnpm，不要混用 npm／yarn**；改完任何功能後至少跑 lint + 相關測試才算完成（見第 7 節）。

---

## 5. 資料模型（13 張表，勿隨意增刪表）

- **商品與選項**：Product、OptionType、OptionValue、ProductOption、ProductOptionValue
- **會員與購物車**：Member、Cart、CartItem
- **訂單與金流**：Order、OrderItem、Payment
- **通知與狀態**：OrderStatusLog、Notification

三個核心設計，改動相關程式前務必遵守：

1. **資料驅動配置器**：選項由資料決定，三層控制——類別 `applies_to` → 款式 `ProductOption` → 值白名單 `ProductOptionValue`。戒指逐款限定寶石／戒圍，**白名單必留**，前端不得繞過。
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
