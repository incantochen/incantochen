# CLAUDE.md — incantochen（高端半客製彩色寶石電商）

> 文件更新日期：2026-06-26

> 給 Claude Code 的專案施工圖。每次對話開始自動載入。
> 規劃文件（含 memory、任務清單）放在 `docs/`；本檔是「開發層」的對齊版本。
> 維護原則：保持精簡（目標 < 200 行）、規則具體可驗證、過時就刪。
> 📁 **文件目錄**：所有文件位置與用途見 [`docs/docs-index.md`](docs/docs-index.md)
> 📋 **工作日誌**：本次／下次作業記錄見 [`docs/work-log.md`](docs/work-log.md)

> **目前實際狀態（隨開發更新）：** 已建立 Next.js 16.2.9 骨架（TypeScript、Tailwind、ESLint、App Router、`src/`、Turbopack、`@/*`），`pnpm dev` 可啟動。
> ✅ **T39 UI kit 基礎完成（2026-06-26）**：shadcn/ui 已初始化；品牌色票（Emerald/Gold 完整色階）與雙軌字體（`--font-head`＝EB Garamond＋Noto Serif TC，`--font-body`＝Hanken Grotesk＋Noto Sans TC）已寫入 `globals.css @theme`；`button.tsx` 改寫為品牌規格（11.5px、tracking .2em、uppercase、rounded-btn 2px，四個變體：solid/gold/outline/ghost）；`.eyebrow` 定義於 `@layer components`（11px、.34em、大寫、金色 secondary）。
> ⚠️ **下列技術棧雖已鎖定，但尚未安裝**：Resend、ECPay 串接、測試框架。動到它們時先安裝再使用，不要假設已存在、也不要憑空 import。（Supabase／Zod 已安裝）
> ✅ **資料庫 schema 已套用至雲端 production**（project-ref `wdmigbqdhernmrfpzzxk`）：`0001`（13 張表）＋`0002`（11 條 RLS policy）已 `db push`、雲端驗收通過；型別已生於 `src/types/database.types.ts`；commit `c124482`。後續改 schema 一律**新增** migration（已套用的不可改）。
> ✅ **M0 全數完成（2026-06-25）**：T01–T05、T43、T46、T52。**關鍵環境細節**：①`.env.local` 接的是**雲端 production**（非本機 `127.0.0.1:54321`），改 seed／測試資料兩邊都要各跑一次（本機 `db reset --local`＋雲端 `db query --linked --file`）。②Vercel env vars／Supabase secret 一律由使用者本人到對應 Dashboard 設定，不經過 Claude。③Production：`https://jewelry-shop-delta.vercel.app`；staging preview 別名：`https://jewelry-shop-git-staging-fishead02290-3279s-projects.vercel.app`。④Auth(T05) **production 端設定尚待使用者手動處理**（Site URL／Redirect URLs／Magic Link 範本，見 `docs/work-log.md`）；`/auth/confirm` 頁面已在 T06/T07 完成。
> ✅ **T15/T16/T18 戒指 PDP＋配置器＋報價引擎已完成**：`src/app/products/[slug]/page.tsx`＋`src/components/product-configurator.tsx`（client component：chip 選取／數量 stepper／即時計價，公式見 `docs/data-model.md` §4.2）。範圍不含「關於這件作品」／「猜你喜歡」（無真實內容不杜撰）、即時換圖 T17（暫緩，依賴 T55/T56 3D 素材）。
> 📌 **流程變更（M1 起）**：改用 feature branch＋PR，不再直接 push master；PR 連結給使用者看過、回覆「沒問題」後才 merge。
> ✅ **T19/T20/T21 購物車（寫快照／讀取／改數量／刪除）已完成**：**關鍵架構**——`cart`／`cart_item` 的 RLS 對 anon/authenticated **讀寫全拒**，一律走 `src/lib/supabase/service-role.ts`（`import "server-only"` 防呆）。寫入前伺服器端用白名單重算 `unit_price_snapshot`／`config_snapshot`，**不採信前端價格**。改數量／刪除前先驗證 `cart_item` 所屬 `cart.guest_token` 與當前 cookie 一致（擁有權檢查，防亂猜 id 動到別人購物車）。訪客身份用 `guest_token` httpOnly cookie。新增環境變數 `SUPABASE_SERVICE_ROLE_KEY`（使用者本人填入本機＋Vercel，不可加 `NEXT_PUBLIC_` 前綴）。
> ✅ **T06/T07 登入入口＋路由保護已完成（2026-06-25）**：`/login`（Email OTP 主＋一鍵重寄）、`/auth/confirm`（magic link 落地頁，**按鈕才消耗 token**，不在 `useEffect` 自動驗證）、`src/proxy.ts`（Next 16 慣例，取代 `middleware.ts`，必須**named export `proxy`** 而非 `middleware`，每請求刷新 session）、`src/lib/auth/require-user.ts`（`requireUser()` 共用保護機制，`/account` 為最小驗證用頁面，T08 會擴充非丟棄）。**關鍵發現**：①`member` 表只有 SELECT policy、無 INSERT policy，建會員 row 一樣要走 service role（`find-or-create-member.ts`）。②**雲端 production 實際 OTP 碼是 8 位數，不是本機 config.toml 設定的 6 位**——原本寫死 `/^\d{6}$/` 會擋掉真實使用者的驗證碼，已改成不假設固定長度。Playwright＋`admin.generateLink`（不寄真信，取得測試用 OTP/token_hash）端到端驗證：登入→`/account`顯示歡迎訊息→登出→重訪被導回 `/login`，雲端 `member` 表確認寫入，測試帳號已清除。
> ✅ **T22 結帳頁（收件＋配送）已完成（2026-06-25）**：`/checkout`（讀 T21 `getCart()`，空車導回 `/cart`）＋ `checkout-form.tsx`（Zod 驗證，`src/lib/checkout/schema.ts`）。**重要釐清**：結帳本身**不需要 OTP／magic link**——Email 只是輸入框，「結帳即會員」要到 T23 建立訂單時才在背景用 admin API 處理，使用者完全無感。已查證 ECPay 文件（[ECPay-API-Skill](https://github.com/ECPay/ECPay-API-Skill)）：①付款建立 API 不需收件人資料（消費者在綠界頁面自己填）；②黑貓宅配物流 API 需要**獨立的郵遞區號欄位**（`ReceiverZipCode`），已加進表單（`orders` 表暫無對應欄位，留給 T48 決定）。送出按鈕刻意 disabled（T23/T48/T57 未完成）。Playwright 驗證：空車導向、表單即時驗證（`onBlur`，因為按鈕本身 disabled 不能靠送出觸發）、已登入時 Email 自動帶入。
> ✅ **T57 客製例外告知與同意已完成（2026-06-26）**：`checkout-form.tsx` 加入琥珀色「客製商品注意事項」區塊＋必填同意 checkbox；`checkoutFormSchema` 加入 `customConsent: z.literal(true)`（Zod v4）；`eslint.config.mjs` 加入 `.claude/**` ignore。同意時間戳記寫入（`consent_at`）留給 T23；⚖️ 法律文字為草稿佔位，上線前以律師審定版取代（T36）。`orders` 表原已有 `custom_consent`/`consent_at` 欄位，**無需新增 migration**。
> ✅ **T23 建立訂單已完成（2026-06-26）**：`src/app/checkout/actions.ts`（`createOrder` server action：結帳即會員＋`order`/`order_item` 快照寫入＋清購物車＋redirect）、`src/app/checkout/success/page.tsx`（成功頁，顯示訂單號＋Email 登入提示）、`supabase/migrations/0003_add_zip_code_to_orders.sql`（`orders` 表加 `zip_code` 欄位，已 `db push` 至雲端）。T48 物流暫緩，`shipping_fee = 0` 佔位。
> ✅ **購物車徽章已完成（2026-06-26）**：`SiteHeader` 的購物袋圖示右上角顯示紅色數字徽章（最高 `9+`）；`src/lib/cart/get-cart-count.ts`（service role 讀 guest_token cookie 取數量）；加入購物袋成功後 `router.refresh()` 即時更新。
> ✅ **T24 ECPay sandbox 設定已完成（2026-06-26）**：安裝官方 ECPay-API-Skill 到 `.claude/skills/ecpay`（綠界官方維護知識庫）。**CheckMacValue 簽章演算法**已實作並對官方 8 組測試向量全數比對通過（金流 SHA256／物流 MD5 用不同金鑰與演算法，不可混用）。**sandbox 連線測試成功**：`MerchantID=3002607` 對 `payment-stage.ecpay.com.tw` 送出真實請求，收到正確付款頁。**關鍵踩坑**：①Bash shell 傳中文參數給 curl 會編碼失真導致 CheckMacValue 錯誤——必須用 Node `fetch()`/`URLSearchParams` 直送，不要 shell out。②此環境 IPv6 連 ECPay sandbox 會被重置，要強制 IPv4（`NODE_OPTIONS=--dns-result-order=ipv4first`）。
> ✅ **T25 建立付款請求並導向 ECPay 已完成（2026-06-26）**：`src/lib/ecpay/check-mac-value.ts`（SHA256 CheckMacValue + timing-safe verify）、`src/lib/env.server.ts`（server-only ECPay 環境變數，分開 `env.ts` 不汙染前端）、`src/lib/ecpay/aio-payment.ts`（`buildAioParams()`：MerchantTradeNo 去 hyphen、Taiwan time、ItemName 截 200 字）、`src/app/checkout/pay/page.tsx`（SSR auto-submit form）、`src/components/ecpay-auto-submit.tsx`（Client Component useEffect 送 form，App Router dangerouslySetInnerHTML script 不執行）、`src/app/api/ecpay/order-result/route.ts`（POST handler 303 redirect，CheckMacValue 驗證留 T26）。**使用者須手動加到 `.env.local`**：`ECPAY_MERCHANT_ID=3002607`、`ECPAY_HASH_KEY=pwFHCqoQZGmho4w6`、`ECPAY_HASH_IV=EkRm7iFT261dpevs`、`ECPAY_PAYMENT_URL=https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5`、`NEXT_PUBLIC_SITE_URL=http://localhost:3000`。Vercel 正式上線時換正式金鑰＋URL。
> ✅ **T26 ECPay ReturnURL Webhook 已完成（2026-06-26）**：`src/app/api/ecpay/notify/route.ts`（POST handler：CheckMacValue SHA256 驗章→冪等查 payment 表→RtnCode=1 更新 orders.status paid + upsert payment paid→RtnCode≠1 upsert payment failed→always 1|OK HTTP 200，外層 try/catch 防 500）。不需新增 migration。
> ✅ **T27 付款結果頁已完成（2026-06-26）**：`/checkout/success`（server component：查 orders+member join；`paid` → 成功 UI；`pending_payment` → `order-status-check.tsx` client-side polling `router.refresh()` 每 3 秒最多 90 秒，逾時顯示 amber「將以 email 通知」）；`/checkout/failed`（失敗頁：已 `paid` → redirect success；否則顯示重試按鈕）。`useRef(0)` + `startRef.current = Date.now()` 於 useEffect 避免 react-hooks/purity lint error。`order-result` route 失敗時改 redirect `/checkout/failed?order=xxx`。
> ✅ **T53 ECPay MerchantTradeNo 冪等性已完成（2026-06-26）**：`src/lib/ecpay/merchant-trade-no.ts`（`generateMerchantTradeNo(orderNo)`：去 hyphen 17 字元 + 2 隨機字元 = 19 字，ECPay 20 字上限內）；`checkout/pay/page.tsx` reuse 現有 `pending` payment row 或建新 unique trade no；`notify/route.ts` 以 `merchant_trade_no` 為 lookup key，UPDATE 加 `.eq("status","pending")` 競態守衛。
> ✅ **T41 伺服器端驗價＋金鑰隔離已完成（2026-06-26）**：`src/lib/quote/verify-prices.ts`（Zod 驗 config_snapshot；DB 重查 base_price + option_value whitelist；重建 verifiedSelections/configSnapshot；回傳 `priceChanged: boolean`）；`env.server.ts` 加 `SUPABASE_SERVICE_ROLE_KEY: required()`（fail-fast）；`service-role.ts` 改用 `serverEnv.SUPABASE_SERVICE_ROLE_KEY`；`createOrder` 驗價後若有 `priceChanged` → 更新 cart_item 快照 → `revalidatePath` → 回傳 `{ ok: false, priceUpdated: true }` 不建單（R/S/Q loop，對齊 user-flow.md）；`checkout-form.tsx` 區分 amber 警示（priceUpdated）vs 紅色硬錯誤。**金額安全紅線完整實現：訂單金額 100% 以 DB 白名單重算，絕不信任 cart 快照。**
> ✅ **T30a Email 下單確認已完成（2026-06-27）**：`src/lib/email/order-confirmation.ts`（`import "server-only"`；查 orders+order_item+product+member.email；buildEmailHtml()；`sendOrderConfirmation(orderId)`）；`notify/route.ts` 兩個 paid path 各加 `void sendOrderConfirmation().catch(() => {})`（fire-and-forget）；`env.server.ts` 加 `RESEND_API_KEY: required()`。⚠️ 目前 FROM=`onboarding@resend.dev`（只能寄到 Resend 帳號 email）；T35 網域驗證後換 `orders@incantochen.com` 並移除 to 覆蓋。
> ✅ **T49 新訂單通知店家已完成（2026-06-27）**：`src/lib/email/new-order-notification.ts`（同架構；TO 固定=`fishead02290@gmail.com`；主旨 `[新訂單] 訂單號 — NT$總金額`；HTML 含客人姓名/email/地址/品項/總計）；`notify/route.ts` 兩個 paid path 加 `void sendNewOrderNotification().catch(() => {})`；T35 後 `OWNER_EMAIL` 改為 env var。**M1 全數完成。**
> ✅ **T65 OrderItem 商品名稱快照已完成（2026-07-02）**：`supabase/migrations/0005`（`order_item.product_name_snapshot text`，**刻意 nullable**＋回填既有訂單，⚠️ **須先 `db push` 再 merge/部署**）；`verifyCartPrices` 回傳 `productName`（與驗價同一次 DB 查詢），`createOrder` 寫入快照；顯示端（會員／後台／Email／ECPay ItemName）快照優先、join 現值僅 null 窗口 fallback；會員訂單詳情頁移除 T32 的 service role 補查 workaround。定案原則：**訂單成立即契約**，商品改名/調價/下架不回寫已成立訂單，付款重試不重驗價；待付款逾期取消記為 T66。
> ✅ **T33 售後申請已完成（2026-07-02）**：新增第 14 張表 `support_request`（`supabase/migrations/0006`，破例增表，一次到位供 T47 沿用）——`request_type` text+check（`return_defect`/`repair_maintenance`）、`status` 刻意不加 check（T47 定案 RMA 狀態機後補）、RLS 僅 `select own`、無 insert/update/delete policy（寫入一律 service role）、禁刪。**業務拍板**：半客製品＝法定客製品，無七天鑑賞退貨；客戶端僅開放單一入口「**商品問題回報**」（存 `return_defect`，無類型選擇，`⚖️ TODO(T36)` 告知文字含 24 小時到貨異常聯絡窗口）；`repair_maintenance` 僅供後台手動建立。新增 `src/lib/support/`（常數＋Zod schema＋測試）、`src/lib/email/support-request-notification.ts`（鏡射 `new-order-notification.ts`，`replyTo` 客人 email）、`/account/orders/[id]/support`（頁面＋action＋表單）、訂單詳情頁入口按鈕＋摘要卡、`/admin/orders/[id]` 售後區塊（狀態更新＋手動建案，鏡射既有 admin gray 風格，非前台品牌 token）。過渡期退款走綠界廠商後台手動退刷＋既有 Admin Override（T31）；完整審核分流＋退刷 API 自動化留 T47。

---

## 1. 專案概覽

- **產品**：**incantochen** — 高端半客製彩色寶石飾品電商。MVP 做「半客製」——標準款 + 客人選配，價格選配當下即時計算，走標準電商結帳。**全品類**：戒指／耳環／手鍊／項鍊。
- **全客製**（報價→確認書→鎖價）為 Phase 3，**MVP 僅做預約／詢問表單**。
- **核心策略**：單人開發、骨架優先、**戒指起步**，其他品類（耳環／項鍊／手鍊）日後靠後台自行擴充。
- **目前階段**：M-1／M0 全數完成。**M1 全數完成**：T06／T07／T15／T16／T18／T19／T20／T21／T22／T57／T23／T24／T25／T26／T27／T53／T41／T30a／T58／T51／**T49**（登入＋路由保護→PDP→配置器→報價→購物車→結帳→建立訂單→ECPay 金流→付款結果頁→冪等性→伺服器端驗價→Email 下單確認→應用層安全防護→報價引擎單測→新訂單通知）。**T17 暫緩**（依賴 T55/T56 3D 素材）。**T48 暫緩**（物流策略待確認）。**M2 進行中**：T65（OrderItem 商品名稱快照）、T33（售後申請）已完成。里程碑序列：M0 → M1 ✅ → M2（進行中）→ M3 → M4 → M5。

---

## 2. 技術棧（已鎖定，勿擅自更換）

| 層             | 選用                                                                         |
| -------------- | ---------------------------------------------------------------------------- |
| 前端           | **Next.js 16**（App Router）＋ shadcn/ui ＋ Tailwind CSS                     |
| 函式庫         | **React 19.2**（隨 Next.js 16，勿單獨變更版本）                              |
| 語言           | **TypeScript**（strict）                                                     |
| 套件管理器     | **pnpm**（鎖定，勿混用 npm／yarn；lockfile 進 git）                          |
| Runtime        | **Node.js 20+**（Next.js 16 最低需求）                                       |
| 部署           | Vercel（含 CI、preview 為 staging）                                          |
| 資料庫／後端   | Supabase（Postgres）                                                         |
| 會員登入       | Supabase Auth — **Email OTP 驗證碼（主）＋ Magic link（輔）**，免密碼        |
| 圖片儲存       | Supabase Storage                                                             |
| 金流／電子發票 | 綠界 ECPay                                                                   |
| 物流           | 綠界黑貓宅配（保價＋本人簽收，**不開放超商**）                               |
| Email          | Resend                                                                       |
| 驗證           | Zod（所有外部輸入；以 `z.infer` 推導型別）                                   |
| DB migration   | **Supabase CLI**（SQL 於 `supabase/migrations/`；**勿引 ORM 管 migration**） |

**Next.js 16 注意事項：**

- Turbopack 為預設打包器；快取改為明確的 Cache Components（opt-in），預設動態渲染——電商的價格／庫存／訂單本來就該即時，符合需求。
- 路由攔截已從 `middleware.js` 改為 **`proxy.ts`**（用於 magic link 授權的進入點寫在這裡）。
- 商品組合圖採「程式合成」：Blender 3D 素材 + 前端擬真疊圖（對齊＋陰影高光）。**MVP 不做 3D 即時預覽**。

**TypeScript 設定基線：**

- `tsconfig.json` 啟用 `strict: true`，並額外開 **`noUncheckedIndexedAccess: true`**（金流／電商必備，強制處理取值可能為 undefined）。
- 路徑別名 `@/*` → `./src/*`。
- **Supabase 型別自動生成**：每次改 schema 後跑 `supabase gen types typescript`，產出 14 張表的型別，查詢要有端到端型別安全。
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

## 5. 資料模型（14 張表，勿隨意增刪表；T33 售後為唯一破例，已收斂為一次性）

- **商品與選項**：Product、OptionType、OptionValue、ProductOption、ProductOptionValue
- **會員與購物車**：Member、Cart、CartItem
- **訂單與金流**：Order、OrderItem、Payment
- **通知與狀態**：OrderStatusLog、Notification
- **售後**（T33 新增）：support_request（`request_type`：`return_defect`／`repair_maintenance`；RLS 僅 select own，寫入走 service role）

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
- ✅ **T58 應用層安全防護（2026-06-27）**：Security headers（X-Frame-Options/nosniff/Referrer-Policy/Permissions-Policy/CSP/HSTS）已加入 `next.config.ts`。**CSP 注意**：`script-src` 在 dev 環境含 `unsafe-eval`（React dev mode 需要），production build 自動移除；上線前用 securityheaders.com 掃 staging URL 確認。登入 email 改用 `z.string().email()` + `trim().toLowerCase()`；OTP 速率限制（Upstash Redis）：requestOtp 雙重 IP+email 限制，verifyOtpCode IP 限制 30 req/min；IP 取得 fallback：`cf-connecting-ip → x-forwarded-for → x-real-ip → null`（null 時跳過 IP limit 避免共用 bucket 誤鎖）。

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
