# security-foundation.md — 資安地基不變式清單

> 建立：2026-07-18（T124 收尾定案：一次性地基審查改制度化為例行漂移檢核）
> 用途：`/security-foundation` skill 逐條驗證的單一出處。每條＝**斷言→錨點→機械驗法→例外白名單**。
> 維護：dev-next 結案流程內建——merge 的 PR 若動到地基，**同步增修本檔對應條目**（新防線加條目、錨點變更改錨點）。

## 頻率規則（與 merge 速度掛鉤，非日曆儀式）

- **現行（M2 高速期）**：每週三一次（與週一／四排程 dev-review 錯開）。依據：本期 merge 速度高（單週多支 PR 碰資安面），實際漂移週期為數天～兩週（F-021 距 T99 開票 3 天；PR #70 批內即發生 matcher 清單失同步）。
- **每月檢視一次頻率**：PR 速度降檔（如上線後維護期、一週 <2 支碰地基的 PR）→ 降為雙週或改**事件觸發**（動到地基的 PR merge 後才跑）。本規則防止機制淪為沒人敢刪的空轉儀式。
- **升級規則**：任一條判 ❌ 破口 → 當場停、建議使用者觸發深審（ultra 或本機 max）聚焦該面向；⚠️ 漂移 → 正常走 review-findings 管線。
- **上線銜接**：T38 checklist 引用「最近一次地基審查全 ✅」為必要項。

## 判定三態

- ✅ 持平：斷言成立、驗法通過。
- ⚠️ 漂移：防線仍在但出現繞過點／清單失同步／描述過時（寫入 review-findings.md，F 編號、去重不重報）。
- ❌ 破口：斷言不成立（防線失效）。立即停下回報。

---

## 不變式清單

### 1. RLS deny-by-default
- 斷言：全表 enable RLS；前台僅「select own」或「公開唯讀且限 `status='active'`」；帳務表禁硬刪。
- 錨點：`supabase/migrations/`（0001–0014）。
- 驗法：本期新增 migration 逐支讀——不得出現放寬既有 policy／新表漏 enable；`grep -c "enable row level security"` 對表數。
- 例外：admin 走 service role（設計如此）。

### 2. 寫入一律 service role＋擁有權檢查
- 斷言：cart／訂單鏈／member／support_request 的每個 mutation action 在寫入前驗擁有權（`guest_token` 一致或 `member_id === user.id`）。
- 錨點：`src/lib/supabase/service-role.ts`（`import "server-only"` 防呆）。
- 驗法：grep `createServiceRoleClient` 本期新增呼叫點，逐一確認寫入前有擁有權守衛。

### 3. guest_token 生命週期
- 斷言：httpOnly cookie、30 天 rolling **僅** `addToCart` 成功時重設；cart_item 任何改動前先驗 `cart.guest_token` 與 cookie 一致；90 天過期車由 cron 清。
- 錨點：`src/lib/cart/`、`/api/cron/cart-cleanup`。
- 驗法：grep `guest_token` 新增讀寫點；cookie 設定點僅 addToCart 一處。

### 4. 價格唯一出處
- 斷言：建單鏈上唯一的金額計算是 `verifyCartPrices`（DB 白名單重算）；不存在信任前端／快照價格的新路徑；價格變動回 `priceUpdated` 不建單。
- 錨點：`src/lib/quote/verify-prices.ts`、`create-order-from-cart.ts`。
- 驗法：grep `unit_price` / `total_amount` 的新運算點，逐一確認源頭是 verifyCartPrices 輸出。

### 5. Cron 驗證單一出處
- 斷言：`CRON_SECRET` 只出現在 `require-cron-auth.ts` 與 env 模組；每支新 cron route 必經 `requireCronAuth`。
- 錨點：`src/lib/cron/require-cron-auth.ts`。
- 驗法：`grep -r CRON_SECRET src/` 出現位置僅上述兩處＋測試 mock；`src/app/api/cron/*/route.ts` 每支 import requireCronAuth。
- 歷史教訓：F-021（第二支 cron 各自手刻比對、漏 timing-safe）。

### 6. Timing-safe 比對單一出處
- 斷言：`timingSafeEqual` 只允許經 `src/lib/timing-safe-equal.ts`（sha256 digest 定長比對、不洩長度）；禁再手刻「比長度→timingSafeEqual」複本。
- 錨點：`src/lib/timing-safe-equal.ts`；消費者：check-mac-value／order-access-token／require-cron-auth。
- 驗法：`grep -rn "timingSafeEqual" src/` 除 helper 本體與其 import 外不得出現。
- 歷史教訓：曾同時存在三份手刻複本（PR #70 收斂）。

### 7. Webhook／對帳冪等
- 斷言：payment 狀態推進一律條件式 UPDATE（`.eq("status",…)` CAS）；關鍵信走 `sendOnce`（notification `unique(order_id,type)`）；新寫入路徑不得 check-then-act。
- 錨點：`/api/ecpay/notify`、`/api/cron/ecpay-reconcile`、`src/lib/notification/send-once.ts`、`state-machine.ts`（transition RPC）。
- 驗法：本期新增的 payment／orders UPDATE 逐一確認帶前置狀態條件。

### 8. Email escape
- 斷言：客人自由輸入插進 HTML（email 模板）前一律 `escape-html.ts`。
- 錨點：`src/lib/email/`、`src/lib/escape-html.ts`。
- 驗法：grep email 模板的 `${` 插值，客人輸入欄位（姓名／地址／說明）逐一確認過 escapeHtml。
- 歷史教訓：F-001（T72 修兩支、第三支漏）。

### 9. CSP 不變式（T97）
- 斷言：(a) document CSP 唯一出處＝`src/proxy.ts`（每請求 nonce＋strict-dynamic，production）；(b) `next.config.ts` 僅設圖檔／favicon 靜態最小 CSP，**且其副檔名 source 與 proxy matcher 排除清單對齊**；(c) 全站無 `force-static`／`use cache`／`generateStaticParams`（nonce 依賴動態渲染）；(d) build 型別檢查僅 preview 關（PR #74）。
- 錨點：`src/proxy.ts`（buildCsp＋matcher）、`next.config.ts`（headers＋typescript 區塊）。
- 驗法：兩份副檔名清單 diff 比對；`grep -r "force-static\|use cache\|generateStaticParams" src/app` 應空。
- 歷史教訓：PR #70 批內 matcher 與 next.config 清單即失同步（avif|ico）。

### 10. IP 信任模型（T121）
- 斷言：client IP 唯一出處＝`src/lib/get-client-ip.ts`（`x-vercel-forwarded-for` → `x-forwarded-for` 最左 → null）；禁新增直接讀 forwarded 類 header 的點；null 時呼叫端跳過 IP 限流（不共用 bucket）。
- 錨點：`src/lib/get-client-ip.ts`。
- 驗法：`grep -rn "x-forwarded-for\|x-real-ip\|cf-connecting-ip\|x-vercel-forwarded-for" src/` 僅 helper 本體＋其測試。
- 備註：掛 Cloudflare 時須把 cf-connecting-ip 調回首位（見檔內註解）。

### 11. 限流覆蓋
- 斷言：可灌爆的寫入路徑（OTP 請求／驗證、購物車寫入、結帳、售後申請、訂單頁枚舉、**發票統編／條碼 ECPay 驗證**〔T129／F-024〕）都掛 `src/lib/rate-limit.ts` 的 limiter（各自 prefix、fail-open 走 safeLimit）。發票驗證因會對 ECPay 發外部請求＋是統編→公司名 oracle，另須在「確認 cart 非空」之後才呼叫（`checkout/actions.ts`）。
- 錨點：`src/lib/rate-limit.ts`。
- 驗法：本期新增的 server action／route 逐一問「可被灌爆嗎」；新 limiter 必有專屬 prefix。

### 12. Supabase `{error}` 必檢（§6／F-008／F-017 根因）
- 斷言：每個 Supabase 呼叫解構並處理 `error`；「查詢失敗 ≠ 查無資料」——頁面層 throw 交 error boundary／顯示系統忙碌，不得誤報空清單／notFound／redirect 走人。
- 錨點：全 codebase；error boundary：`app/cart|checkout|account/error.tsx`。
- 驗法：本期新增的 `.from(` 查詢逐一確認 error 分支（開放式，配合 dev-review 的 F1 類別掃描）。
- 歷史教訓：F-008 修 7 處後同根因仍擴散（F-017），逐點修必配清單驗。F-017 最後未收斂的 `products/[slug]/actions.ts`（product／product_option）＋同函式 count 查詢已於 2026-07-18（T130／PR #81）補齊，F-017 全數收斂——印證「逐點修必配清單驗」直到清單清空。
