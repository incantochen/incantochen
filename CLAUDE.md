# CLAUDE.md — incantochen（高端半客製彩色寶石電商）

> 文件更新日期：2026-07-08

> 給 Claude Code 的專案施工圖。每次對話開始自動載入。
> 規劃文件（含 memory、任務清單）放在 `docs/`；本檔是「開發層」的對齊版本。
> 維護原則：保持精簡（目標 < 200 行）、規則具體可驗證、過時就刪。
> 📁 **文件目錄**：所有文件位置與用途見 [`docs/docs-index.md`](docs/docs-index.md)
> 📋 **工作日誌**：本次／下次作業記錄見 [`docs/work-log.md`](docs/work-log.md)

## 0. 目前實際狀態與 Durable 架構規則

> **（2026-07-08 瘦身改版）** 任務進度唯一權威來源＝`docs/tasks.csv`，逐次作業細節見 `docs/work-log.md`——完成任務**不再**逐條追記於本檔。本節只保留「寫程式時隨時要記得」的環境事實與跨任務規則；歷次任務的完整敘事（原 2026-07-04 版頂部狀態區）備份於 `../backup/_backup_docs_20260707/CLAUDE.md`。

### 0.1 環境事實

- 技術棧全數已安裝可用：Next.js 16.2.9 骨架、shadcn/ui＋品牌 token（`globals.css @theme`）、Supabase、Zod、Resend、vitest、ECPay 串接、Sentry、Upstash Redis。
- **DB**：雲端 production（project-ref `wdmigbqdhernmrfpzzxk`）已套用 migrations `0001`–`0007`（14 張表＋RLS deny-by-default）。改 schema 一律**新增** migration（已套用不可改）、**先 `db push` 再 merge/部署**、改完 `gen types`。
- `.env.local` 接**雲端 production**（非本機 `127.0.0.1:54321`）；seed／測試資料本機＋雲端各跑一次（本機 `db reset --local`＋雲端 `db query --linked --file`）。
- Vercel env vars／Supabase secret／各家 Dashboard 一律**使用者本人**操作，不經過 Claude。
- Production：`https://jewelry-shop-delta.vercel.app`；staging preview 別名：`https://jewelry-shop-git-staging-fishead02290-3279s-projects.vercel.app`。
- ⚠️ Supabase Auth **production 端 Dashboard 設定仍懸置**（T83：Site URL／Redirect URLs／Magic Link 範本）。
- ECPay sandbox 環境變數（`.env.local`，使用者自填）：`ECPAY_MERCHANT_ID=3002607`、`ECPAY_HASH_KEY=pwFHCqoQZGmho4w6`、`ECPAY_HASH_IV=EkRm7iFT261dpevs`、`ECPAY_PAYMENT_URL=https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5`、`NEXT_PUBLIC_SITE_URL=http://localhost:3000`；正式上線（T35）換正式金鑰＋URL。

### 0.2 Durable 架構規則（動到對應模組必守）

- **寫入權限**：`cart`／`cart_item`／`member`／訂單鏈／`support_request` 的前台 RLS 讀寫全拒（或僅 select own）——寫入一律走 `src/lib/supabase/service-role.ts`（`import "server-only"` 防呆）；`member` 無 INSERT policy，建會員走 `find-or-create-member.ts`。
- **訪客身份**：`guest_token` httpOnly cookie（90 天）；任何 cart_item 改動前先驗 `cart.guest_token` 與 cookie 一致（擁有權檢查，防亂猜 id 動到別人購物車）。
- **金額**：`verify-prices.ts` 依 DB 白名單重算，絕不信任前端／快照價格；價格變動→更新 cart_item 快照＋回傳 `priceUpdated` **不建單**（R/S/Q loop，對齊 user-flow.md）。
- **訂單成立即契約**：快照（`unit_price_snapshot`／`config_snapshot`／`product_name_snapshot`）優先顯示、join 現值僅 null 窗口 fallback；商品改名/調價/下架不回寫已成立訂單；付款重試不重驗價（逾期取消＝T66）。
- **Auth**：`src/proxy.ts` 必須 named export `proxy`（Next 16 取代 middleware.ts）；magic link 落地頁**按鈕才消耗 token**（不在 useEffect 自動驗證）；OTP **不假設固定長度**（雲端 production 實際 8 碼、本機 config.toml 6 碼）；結帳頁不需 OTP——「結帳即會員」在 `createOrder` 背景處理。
- **ECPay**：CheckMacValue 金流 SHA256／物流 MD5 不可混用；MerchantTradeNo＝order_no 去 hyphen 17 字＋2 隨機字元＝19 字（單一出處 `merchant-trade-no.ts`）；webhook 以 `merchant_trade_no` 查 payment、條件式 UPDATE（`.eq("status",…)`）防競態；測試打 ECPay API 用 Node `fetch()` 不 shell out（Bash 傳中文編碼失真）＋強制 IPv4（`NODE_OPTIONS=--dns-result-order=ipv4first`）。
- **Email**：FROM 目前 `onboarding@resend.dev`（只能寄到 Resend 帳號 email；T35 網域驗證後換 `orders@incantochen.com`）；客人輸入插 HTML 前一律 `escape-html.ts`；關鍵信走 `send-once.ts` 去重（notification `unique(order_id,type)`）；serverless 一律 `await`、禁 fire-and-forget。
- **售後**：半客製＝法定客製品、無七天鑑賞退（業務拍板 2026-07-02）；客戶端僅單一入口「商品問題回報」（存 `return_defect`）；`repair_maintenance` 僅後台手動建立；退款過渡期＝綠界後台手動退刷＋Admin Override（人工程序見 `docs/ops-runbook.md`）。
- **後台**：`requireAdmin()` 以 `ADMIN_EMAIL` env 驗證（T09 正式角色系統前的 MVP 做法）；admin UI 用 Tailwind gray 素色，與前台品牌 token 刻意分開。
- **監控／兜底**：Sentry（T37）已接 webhook／寄信／對帳的靜默失敗點；Vercel Cron 每日 ECPay 主動對帳（T89，`/api/cron/ecpay-reconcile`）。`shipping_fee=0` 佔位（T48 暫緩）。
- **流程**：feature branch＋PR，PR 給使用者看過、回覆「沒問題」才 merge（M1 起）。

---

## 1. 專案概覽

- **產品**：**incantochen** — 高端半客製彩色寶石飾品電商。MVP 做「半客製」——標準款 + 客人選配，價格選配當下即時計算，走標準電商結帳。**全品類**：戒指／耳環／手鍊／項鍊。
- **全客製**（報價→確認書→鎖價）為 Phase 3，**MVP 僅做預約／詢問表單**。
- **核心策略**：單人開發、骨架優先、**戒指起步**，其他品類（耳環／項鍊／手鍊）日後靠後台自行擴充。
- **目前階段**：M-1／M0／M1 ✅ 全數完成（T17／T48／T55／T56 暫緩）→ **M2 進行中**（完成／待修清單見 `docs/tasks.csv`）→ M3 → M4 → M5。**開發流程全貌見 [`docs/dev-process.md`](docs/dev-process.md)；人工救援程序見 [`docs/ops-runbook.md`](docs/ops-runbook.md)；上線必要子集（🚀 分級）見 [`docs/launch-scope.md`](docs/launch-scope.md)。**

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

- `src/app` — 頁面與 route（含 API route handlers：`api/ecpay/*`、`api/cron/*`）
- `src/proxy.ts` — 路由攔截／session 刷新（Next.js 16，取代舊 `middleware.js`）
- `src/components` — 全站共用元件；`src/components/ui` — shadcn/ui 元件（新增用 `pnpm dlx shadcn@latest add <component>`）
- `src/lib` — 工具函式與模組：`supabase/`（三支 client）、`quote/`（報價引擎，**伺服器端為準**）、`ecpay/`、`email/`、`notification/`、`order/`、`auth/`、`cart/`、`support/`、`pii/`、`env.ts`＋`env.server.ts`（集中、有型別的環境變數）
- `src/types` — 共用型別；`database.types.ts`（Supabase 生成，14 表）
- `supabase/` — migration SQL（`0001`–`0007`）、`seed.sql`
- `docs/` — 所有規劃與規範文件（見 `docs/docs-index.md`）
- `public/brand/` — 品牌素材：logo、favicon、3D 合成商品圖、OG/social 圖（⏳ 待產出）

**路由（IA 定案）**：PDP `/products/[slug]`、品類 `/collections/[category]`、配置器內嵌 PDP（**無獨立 config route**）、**全文搜尋 Phase 2**；後台 `/admin/orders` 已於 T31 上線（商品 CRUD 留 M3）。

新增檔案前先確認該模組既有位置，沿用現有命名與結構，不要另立風格。
**做任何 UI／頁面前，先讀 `docs/brand-guide.md`、對應的 `docs/user-flow.md` 與該頁 wireframe；若該檔尚未產出，先停下提醒我補。品牌 token 以 `tailwind.config` / shadcn theme 為準，不要每頁自行挑色。**

---

## 4. 常用指令

- 安裝相依：`pnpm install`
- 啟動開發：`pnpm dev`
- 建置：`pnpm build`
- 測試：`pnpm test`（vitest，T51 起可用）
- Lint／格式化：`pnpm lint`
- 加 shadcn/ui 元件：`pnpm dlx shadcn@latest add <component>`
- 生成 Supabase 型別：`pnpm supabase gen types typescript`（改 schema 後執行）
- **seed 套用**：`supabase db reset --local`（reset 並自動套用 `seed.sql`；此 CLI 版本〔2.107.0〕無獨立 `db seed` 子指令）
- **一律用 pnpm，不要混用 npm／yarn**

**Windows 環境限制（搜尋指令）：**

- **禁止**從根目錄做全硬碟搜尋（`find /`、`dir /s C:\`、`Get-ChildItem -Recurse` 等）——會掃到 `node_modules`，極慢且可能掛起。
- 一律改用限制深度的相對路徑搜尋，例如 `find . -maxdepth 3 -name "*.ts"`。

---

## 5. 資料模型（15 張表，勿隨意增刪表；破例僅限已核決策：T33 `support_request`、T80 `pii_access_log`〔決策 #13，migration 0009 已套用〕）

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

**🧠 寫程式的思考系統（2026-07-04 起）**：動手寫任何程式碼前**必讀 [`docs/coding-system.md`](docs/coding-system.md)**——逆向推理（每個外部呼叫的四問）、系統性思考（狀態機／並發／重試迴路）、PR 前檢核清單、真實 bug 案例庫。本節下方的通則是它的摘要；完整思考步驟與 checklist 以該檔為準。

**防禦性寫法通則（2026-07-04 起，源自 PR #30 三輪 ultrareview 的共通根因）：**

- **SDK 錯誤回傳必檢查**：Supabase（`{data, error}`）、Resend（`{data, error}`）等「不 throw、用回傳值帶錯誤」的 SDK，**每次呼叫都必須解構並檢查 `error`**，不得只看 `data`。「查詢失敗」≠「查無資料」——只看 `data` 會把 DB 暫時性故障（timeout／連線池耗盡）誤判成「條件不符」而靜默跳過。`error` 非 null 時一律 throw 或明確處理（依呼叫端契約），禁止靜默略過。使用任何第三方 SDK 前先確認：失敗時是 throw 還是回傳錯誤物件？不預設「沒 throw 就是成功」。
- **包裝函式須守住 throw 契約**：若上層邏輯（如 `sendOnce` 重試機制）依賴「失敗會 throw」，被包裝的 SDK 錯誤回傳必須在包裝層轉成 throw，否則上層的錯誤處理形同虛設。
- **numeric 欄位比對前先 `Number()`**：PostgREST 對 Postgres `numeric` 欄位可能回傳字串（生成型別仍標 `number`），直接 `!==` 比對必失敗；`parseInt` 結果先用 `Number.isFinite()` 防 NaN。
- **並發去重用條件式 UPDATE，且 SET 必須改動 WHERE 用到的欄位**：`UPDATE ... WHERE status='x'` 搶鎖時，SET 若不改變任何 WHERE 欄位，Postgres READ COMMITTED 下第二個並發請求重新檢查條件仍會命中（EvalPlanQual），兩邊都搶到。check-then-act（先 SELECT 再決定）在並發下必然有 race，一律改條件式 UPDATE／INSERT on conflict。
- **serverless 禁 fire-and-forget**：`void promise.catch()` 在回應送出後 function 可能被凍結、工作沒做完；一律 `await`（或平台的 `waitUntil`）。
- **識別碼格式互轉單一出處**：如 order_no ↔ MerchantTradeNo 的 slice 重組，只能有一份實作供 import，禁止各處手刻（T67 的 `slice(11)` bug 即散落複本失同步所致）。
- **客人自由輸入插進 HTML（email 模板等）必先 escape**（T72/T84）。

**未經明確同意，不得：** 修改 `.env*`、執行 DB migration、改動 auth／金流／session 邏輯、變更 RLS policy 或 CI 設定。

**Hook 強制護欄（`.claude/`）：** protect-env / protect-migration / dangerous-bash / completion-check / auto-format / session-start。

---

## 7. 工作流程要求

- **逐任務進行**：一次專注一個任務，開始前先說明計畫。
- **涉及 auth／金流／session／migration 的任務一律先進 plan mode**，等確認再動手。
- **完成檢核**：實作 → 自行驗收 → 跑 lint → dev 確認無錯誤 → 才算完成。**T106 落地後**：code review 修完 findings 即跑 `pnpm verify:all`（lint→tsc→vitest→build→E2E→自動產出測試紀錄，計畫見 `docs/test-plan.md`），全綠才開 PR。
- **完成後停下回報**：列出改了什麼、產出什麼、驗收結果，**等確認後再進下一個任務**。
- **commit 規範**：Conventional Commits（`feat:`、`fix:`、`chore:`）。一個任務一支 commit。
- **開 PR 前先本機審查（2026-07-04 起）**：涉及金流／webhook／auth／訂單／email 的改動，開 PR 前 Claude 先自行跑 `/code-review high`（本機、免費）並修完 findings 再開 PR——把 SDK 錯誤處理這類已知模式（§6 防禦性寫法通則）在本機先攔掉，ultra 額度留給深層問題（PR #30 三輪 ultrareview 的教訓：多數 findings 屬本機審查即可抓到的等級）。
- **PR 審查（2026-07-03 起）**：Claude 開完 PR 回報時，**必須評估該 diff 是否建議跑 `/code-review ultra <PR#>` 並附理由**。判斷基準採**反向白名單**：只有「純 docs／UI 樣式與文案／測試檔」的 diff 可省略，**其餘一律建議跑**（本專案幾乎每條路徑都碰錢或個資；2026-07-02 審查證實高風險區不只 auth／金流／訂單／migration，還包括 Email 模板、購物車與 guest token、service role action 的擁有權檢查、識別碼格式互轉、next.config 與 env）。ultra 是雲端多代理審查，計費、由**使用者本人**觸發，Claude 無法代跑；建議跑的 PR，findings 修完才 merge。（里程碑層另有 `/dev-review` 全專案審查＋週一四排程，兩者互補不互代。）
- **不確定就問**：規格、定價邏輯、法規用詞有疑慮時先問，不要自行假設。

### 各任務自驗收指令

seed 驗收（改動 seed.sql 後執行）：`supabase db reset --local` 後逐條跑 `docs/verify-seed.sql`（此 CLI 版本不支援單檔多語句；enum 欄位需 `::text` 轉型）。歷次任務的驗收記錄見 `docs/work-log.md`。

---

## 8. 法規與營運提醒（開發時注意，非程式工作）

- **七天鑑賞期**：客製品主張法定例外，但須結帳告知同意（T57）＋條款載明（T36）。**用詞以律師審定版為準，勿自行擬定。**
- **退款**：客製品限瑕疵／錯誤可退，走綠界退刷。
- **交期告知**：商品頁／結帳／說明頁標示「下單後訂製、交期至少 XX 天」。
- 隱私權政策（T36）、個資刪除走匿名化（T63）為上線必備。
- **售後**：多項待確認（**半客製是否算法定客製品**、退款比例、已開電子發票退款須折讓／作廢），**須律師＋會計確認**，見 `docs/user-flow.md §3.1`。
