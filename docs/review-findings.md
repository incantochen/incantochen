# 開發審查發現（review-findings.md）

> 本檔是 dev-review skill 的工作底稿與唯一累積點：無人值守執行時自動寫入，不動 tasks-todo.csv、不開 issues。
> **只有使用者能把狀態改成「確認」或「不採納」**；經確認的項目才由後續 session 轉入 tasks-todo.csv＋GitHub issues。
> F 編號永久遞增不重用。**發現全文敘事＋審查記錄完整備註＋逐日回歸狀態塊封存於 `review-findings-archive.md`**（2026-07-22 瘦身）；本檔只留「發現一行索引＋審查歷程摘要＋覆蓋表＋老化提醒」的活躍工作面。

---

## 審查歷程摘要

> 每輪的完整備註（delta 複核、逐條回歸確認）見 `review-findings-archive.md`。

| 日期       | 範圍                         | 模型     | 新發現                                            |
| ---------- | ---------------------------- | -------- | ------------------------------------------------- |
| 2026-07-02 | code+schema+flow             | opus-4-8 | F-001～F-004（首份）                              |
| 2026-07-03 | code+schema+flow             | opus-4-8 | F-005～F-006                                      |
| 2026-07-04 | code+schema+flow             | opus-4-8 | F-007                                             |
| 2026-07-07 | code（全面風險）             | fable-5  | F-008～F-013                                      |
| 2026-07-07 | code+schema+flow（平行）     | opus-4-8 | F-014～F-016                                      |
| 2026-07-08 | code+schema+flow             | opus-4-8 | F-017                                             |
| 2026-07-09 | code+schema+flow             | opus-4-8 | F-020                                             |
| 2026-07-10 | code+schema+flow             | opus-4-8 | F-021～F-022                                      |
| 2026-07-13 | code+schema+flow             | opus-4-8 | F-023                                             |
| 2026-07-15 | code+schema+flow             | opus-4-8 | F-024                                             |
| 2026-07-16 | code+schema+flow             | opus-4-8 | 無（覆蓋輪替結案）                                |
| 2026-07-21 | security-foundation 漂移檢核 | opus-4-8 | 無（1 條清單失同步已就地修）                      |
| 2026-07-22 | code+schema+flow             | opus-4-8 | F-025～F-026（皆 P2；PR #86～#115 大 delta 複核） |

---

## 活躍發現

> 全文＋失敗情境＋修法。**只有使用者能把狀態改「確認」或「不採納」**；經確認才轉 tasks-todo.csv＋issues。

### F-025 [P2] addToCart 的 lineUnitPrice 以未 `Number()` 轉型的 base_price／price_delta 直接相加，違反 §6 numeric 轉型規則（latent，目前不觸發）

- 狀態：待確認
- 位置：`src/app/products/[slug]/actions.ts:191`（`const lineUnitPrice = product.base_price + selections.reduce((sum, s) => sum + s.price_delta, 0)`）；快照組裝 `configSnapshot.line_unit_price`／寫入 `cart_item.unit_price_snapshot`（同檔約 :199、:290）
- 失敗情境（條件式）：`product.base_price` 與 `option_value.price_delta` 皆為 `numeric(12,0)`（migration 0001:85、:132）。§6 明載「PostgREST 對 numeric 欄位**可能**回傳字串（生成型別仍標 number）」。**若**該查詢回字串，`reduce` 的 `0 + "500"` 與 `"12000" + "0500"` 會退化成字串串接——`lineUnitPrice` 變 `"120000500"` 之類垃圾值，寫進 cart_item 快照＝購物車顯示錯價、`unit_price_snapshot` 汙染。
- **目前不觸發（反證）**：①PDP client 配置器（`product-configurator.tsx:69-70`）以同組 base_price／price_delta 做 `basePrice + …` 算術並正確顯示金額，證明這條查詢在本部署回傳的是 number；②結帳權威 `verify-prices.ts:81-87、:140-145` 對 base_price／price_delta 做 `typeof !== "number"` 硬守衛並 throw「定價資料異常」——若 runtime 真回字串，**每一筆結帳都會被擋、無單可成**，與 production 有真實訂單／退款的事實矛盾。故此路徑當前 benign，且即便未來 serialization 改變，結帳端 fail-safe（擋單、不造成財務損失）。
- 修法：§6 一致性補強——`const basePrice = Number(product.base_price)`、`price_delta: Number(selectedValue.price_delta)`（`start-price.ts`／`verify-prices.ts` 已這樣做，本檔是唯一漏網的算術點）。純防禦一致性，非活躍 bug；可併入既有前台批次或 §6 巡檢，不需獨立緊急修。
- 記錄：2026-07-22 首次發現（PR #86～#115 大 delta 複核，第一遍對抗性問題集 §6「numeric 轉換點」）。

### F-026 [P2] `shadcn` 列於 `dependencies`（非 `devDependencies`）：把 `@modelcontextprotocol/sdk`→`hono`（4 筆 XSS／path-traversal advisories）拉進 production 依賴樹

- 狀態：待確認
- 位置：`package.json` `dependencies.shadcn`（CLI 工具，`grep` 確認**從未** import 進 `src/`；僅供 `pnpm dlx shadcn add` 用）
- 失敗情境：`pnpm audit`（端點已恢復，見下）回報 10 筆 advisory，其中 4 筆 moderate 全數來自 `.>shadcn>@modelcontextprotocol/sdk>hono`（Server-Side XSS via cx()、path traversal、per-request context 未隔離等）。因 `shadcn` 誤列 production dependency，`pnpm install --prod`／部署產物會把整個 hono server 框架＋MCP SDK 裝進 production `node_modules`。該樹在 app runtime **從不執行**（無 import、無啟動），故無直接 RCE 路徑；具體危害＝①無謂膨脹 production 供應鏈攻擊面；②`pnpm audit --prod` 永久噪音（9 筆），日後真正 production runtime 的 advisory 會被埋沒漏看；③部署體積。
- 修法：`pnpm remove shadcn && pnpm add -D shadcn`（移到 devDependencies）。CLI 用法不受影響（dev 環境仍可 `pnpm dlx shadcn add`）。移除後 `pnpm audit --prod` 應只剩 `next>sharp`（見下）。
- 記錄：2026-07-22 首次發現（flow 範圍依賴安全 `pnpm audit`）。順帶更正舊記錄：review-findings 2026-07-15 註記稱「`pnpm audit` 端點已退役（410）無法執行」——本輪實測**端點已恢復**、可正常執行（10 筆 advisory，餘 6 筆 high 皆 dev/build-only：`eslint`→brace-expansion/js-yaml、`@sentry/nextjs`→`@sentry/webpack-plugin`→fast-uri〔build-time〕；1 筆 `next>sharp` libvips 屬 runtime 但僅處理後台上傳的可信商品圖，非客人輸入，低可利用性）。此三類皆與既有 T91〔Dependabot／定期 audit 機制〕同根，建議 T91 落地時一併以 toolchain 升版消化，不另開任務。

---

## 發現索引（F-001～F-026）

> 一行一筆：編號·嚴重度·標題·狀態·PR#/T#。**全文敘事＋失敗情境＋修法見 `review-findings-archive.md`**。回歸驗證＝依 PR#/T# 去看程式與 PR。

- **F-001 [P1]** 售後通知 Email 未跳脫客人自由輸入的「說明」→ 店家信箱 HTML／釣魚注入 · ✅已修復 · PR #54 T72 T84
- **F-002 [P2]** 售後申請無限流、無去重：登入客人可灌爆店家信箱與 support_request 表 · ✅已修復 · PR #70 T93
- **F-003 [P2]** 相依套件 postcss 8.4.31 有 moderate XSS 公告（CVE-2026-41305） · ✅已修復 · PR #69 T94
- **F-004 [P2]** 最關鍵路徑（webhook、createOrder）無任何自動化測試，修復易靜默回歸 · ✅已修復 · PR #29 T85
- **F-005 [P1]** 登入成功後開放轉址（open redirect）：`?redirect=` 未驗證即 `router.push` · ✅已修復 · PR #49 T86
- **F-006 [P2]** T73 存取控制根因未涵蓋 `checkout/pay`、`checkout/failed` 兩頁（憑 order_no… · ✅已修復 · PR #64 T73
- **F-007 [P2]** 訂單狀態機 UPDATE 缺前置狀態守衛：後台併發（雙擊／多管理者）改狀態→重複／矛盾 order_status_log… · ✅已修復 · PR #53 PR #51 T92 T66
- **F-008 [P2]** 客人端讀取路徑普遍未檢查 Supabase `{error}`：DB 暫時性故障被誤判為「查無資料」，付款中客人被誤導離開 · ✅已修復 · PR #70 PR #73 T95
- **F-009 [P2]** order_no↔MerchantTradeNo 重組邏輯仍散落兩處 inline 複本，違反 §6「格式互轉單一出處」… · ✅已修復 · PR #90 T96
- **F-010 [P2]** Production CSP `script-src 'unsafe-inline'`：XSS 縱深防禦形同未設防 · ✅已修復 · PR #70 T97
- **F-011 [P2]** createOrder 無伺服器端防重複提交：跨分頁併發送出→同一購物車建出兩張待付款訂單 · ✅已修復 · PR #55 T98
- **F-012 [P2-low]** 對帳 cron 的 CRON_SECRET 比對非 timing-safe · ✅已修復 · PR #70 T99
- **F-013 [P2-low]** 根目錄 `types/supabase.ts` 為過時型別殘留：無人引用、與正式生成檔並存易誤 import · ✅已修復 · PR #88 T100
- **F-014 [P1]** ECPay 主動對帳（T89）先翻 payment.status 再推進 order／通知：候選鍵失效造成「已付款訂單永… · ✅已修復 · PR #67 T107 T127
- **F-015 [P2]** 面交前綴 "面交" 格式在寫入端與解析端各自手刻字面量，違反 §6「識別碼格式互轉單一出處」 · ✅已修復 · PR #89 T108 T48 T137
- **F-016 [P2]** read-cart.ts 讀取購物車忽略 Supabase `{error}`：暫時性 DB 故障→購物車「顯示為空」擋… · 已併入T95（合併時去重：T95〔F-008〕已涵蓋 · T95
- **F-017 [P2]** Supabase `{error}` 忽略根因延伸至會員 account 讀取頁與商品詳情頁（T95「7 處」列舉未涵蓋… · ✅已修復 · PR #70 PR #73 PR #81 T130
- **F-018 [P2-low]** T70 PR review：`23505` 錯誤碼字面量在 4 個檔案重複、`CREATE UNIQUE INDEX` … · ✅已修復 · PR #83 T132 T111
- **F-019 [P2-low]** T70 的 unique 約束修法未涵蓋「首次訪客」雙擊情境：guest_token cookie 尚不存在時，併發請求… · 已轉任務(T133／issue #79) · T133 T81
- **F-020 [P2]** addToCart get-or-create 採 insert-first，與 T70 教訓（coding-syste… · ✅已修復 · PR #81 T130
- **F-021 [P2-low]** 新 cron `/api/cron/cart-cleanup` 的 CRON_SECRET 比對非 timing-saf… · ✅已修復 · PR #70 T99
- **F-022 [P2-low]** cart-cleanup 的 DELETE 只綁 `id`、丟失 `member_id IS NULL`／`update… · ✅已修復 · PR #82 PR #85 T81 T134
- **F-023 [P2]** T111 代客建單付款連結把 order_no 定性為刻意散佈的持有型憑證：與 T73 計畫中「pay 頁綁擁有權」的修… · ✅已修復 · PR #64 T73 T111
- **F-024 [P2]** T42 統編／手機條碼驗證 API 在限流與購物車讀取之前呼叫：未認證即可無限打 ECPay 發票驗證端點＋把本站當成統… · ✅已修復 · PR #80 T129
- **F-025 [P2]** addToCart lineUnitPrice 以未 `Number()` 的 numeric base_price／price_delta 直接相加，違反 §6（latent，反證顯示目前回 number 故不觸發） · 待確認 · —
- **F-026 [P2]** `shadcn` 誤列 dependencies：把 `@modelcontextprotocol/sdk`→`hono`（4 筆 XSS/path-traversal advisory）拉進 production 依賴樹（CLI 從不在 runtime 執行） · 待確認 · —

---

## 老化提醒

- **待確認超過 14 天的發現**：無（F-025／F-026 為 2026-07-22 新增，待使用者裁決；皆 P2、非上線阻擋）。
- **從未審查過的檔案（覆蓋次數＝0）**：覆蓋母集 backlog 已於 2026-07-16 清空，僅 `src/types/database.types.ts`（生成檔）免審。本輪（2026-07-22）PR #86～#115 帶入的新業務檔已補審主力（見下方 2026-07-22 註）；少數新 SEO／error-boundary 展示層與純 helper（`seo/{site-meta,breadcrumb-json-ld}`／`json-ld.tsx`／`system-busy-*.tsx`／`order-cancelled-notice.tsx`／`redis.ts`／`timing-safe-equal.ts`／`postgres-error-codes.ts`／各 `error.tsx`／`manifest.ts`／`opengraph-image.ts`／`icon.tsx`／`refund-section.tsx`）尚未逐行入表，留下輪輪替（低風險：展示層與小型 helper，核心金流／退款／狀態機／併發路徑本輪已逐行覆蓋）。

---

## 檔案覆蓋表

> 母集＝`git ls-files` 排除純資產。「審查次數」自本檔首建（2026-07-02）起計；先前 2026-07-02 產生 T67–T83 的審查未留覆蓋表，故未計入。本輪實際逐行讀過者標日期＋1，其餘暫記 0（＝正式輪替尚未覆蓋，非零風險）。

| 路徑                                                                 | 最後審查日期                     | 審查次數 |
| -------------------------------------------------------------------- | -------------------------------- | -------- |
| src/app/api/ecpay/notify/route.ts                                    | 2026-07-22                       | 6        |
| src/app/api/cron/ecpay-reconcile/route.ts                            | 2026-07-22                       | 3        |
| src/lib/ecpay/query-trade-info.ts                                    | 2026-07-07                       | 1        |
| src/lib/order/ensure-paid.ts                                         | 2026-07-22                       | 4        |
| src/lib/notification/send-once.ts                                    | 2026-07-22                       | 4        |
| src/app/api/ecpay/order-result/route.ts                              | 2026-07-07                       | 3        |
| src/app/checkout/actions.ts                                          | 2026-07-22                       | 6        |
| src/app/checkout/pay/page.tsx                                        | 2026-07-15                       | 6        |
| src/lib/quote/verify-prices.ts                                       | 2026-07-22                       | 4        |
| src/lib/email/order-confirmation.ts                                  | 2026-07-04                       | 2        |
| src/lib/email/new-order-notification.ts                              | 2026-07-04                       | 2        |
| src/lib/email/support-request-notification.ts                        | 2026-07-04                       | 2        |
| src/lib/email/order-shipped-notification.ts                          | 2026-07-13                       | 2        |
| src/lib/email/escape-html.ts                                         | 2026-07-07                       | 1        |
| src/app/account/orders/[id]/support/actions.ts                       | 2026-07-10                       | 2        |
| src/lib/support/support-request.ts                                   | 2026-07-10                       | 2        |
| src/lib/support/schema.ts                                            | 2026-07-02                       | 1        |
| src/app/admin/orders/[id]/actions.ts                                 | 2026-07-22                       | 7        |
| src/lib/auth/require-admin.ts                                        | 2026-07-13                       | 4        |
| supabase/migrations/0004_add_actor_to_order_status_log.sql           | 2026-07-02                       | 1        |
| supabase/migrations/0005_add_product_name_snapshot_to_order_item.sql | 2026-07-02                       | 1        |
| supabase/migrations/0006_add_support_request.sql                     | 2026-07-02                       | 1        |
| supabase/migrations/0007_add_payment_last_reconciled_at.sql          | 2026-07-07（平行 session 逐行）  | 1        |
| supabase/migrations/0008_cart_guest_token_unique.sql                 | 2026-07-09（首次，T70）          | 1        |
| supabase/migrations/0009_add_pii_access_log.sql                      | 2026-07-09（首次，T80）          | 1        |
| src/lib/ecpay/aio-payment.ts                                         | 2026-07-07                       | 3        |
| src/lib/ecpay/check-mac-value.ts                                     | 2026-07-10                       | 2        |
| src/lib/ecpay/merchant-trade-no.ts                                   | 2026-07-07                       | 2        |
| src/app/checkout/success/page.tsx                                    | 2026-07-07                       | 2        |
| src/app/checkout/success/order-status-check.tsx                      | 2026-07-07                       | 1        |
| src/app/checkout/failed/page.tsx                                     | 2026-07-03                       | 1        |
| src/app/checkout/page.tsx                                            | 2026-07-07（平行 session）       | 1        |
| src/app/cart/actions.ts                                              | 2026-07-10                       | 3        |
| src/app/cart/page.tsx                                                | 2026-07-08                       | 1        |
| src/app/products/[slug]/actions.ts                                   | 2026-07-22                       | 6        |
| src/app/products/[slug]/page.tsx                                     | 2026-07-08                       | 1        |
| src/app/login/actions.ts                                             | 2026-07-10                       | 2        |
| src/app/login/page.tsx                                               | 2026-07-09                       | 2        |
| src/lib/auth/safe-redirect.ts                                        | 2026-07-09（首次，T86）          | 1        |
| src/app/auth/confirm/actions.ts                                      | 2026-07-07                       | 1        |
| src/app/auth/confirm/page.tsx                                        | 2026-07-07                       | 1        |
| src/app/account/actions.ts                                           | 2026-07-07                       | 1        |
| src/app/account/layout.tsx                                           | 2026-07-08                       | 1        |
| src/app/account/page.tsx                                             | 2026-07-08                       | 1        |
| src/app/account/orders/page.tsx                                      | 2026-07-13                       | 3        |
| src/app/account/orders/[id]/page.tsx                                 | 2026-07-08                       | 2        |
| src/app/account/orders/[id]/support/page.tsx                         | 2026-07-08                       | 1        |
| src/app/account/profile/actions.ts                                   | 2026-07-07                       | 1        |
| src/app/account/profile/page.tsx                                     | 2026-07-08                       | 1        |
| src/app/admin/orders/page.tsx                                        | 2026-07-03                       | 1        |
| src/app/admin/orders/[id]/page.tsx                                   | 2026-07-03                       | 1        |
| src/app/admin/orders/[id]/customer-info.tsx                          | 2026-07-08                       | 1        |
| src/app/admin/orders/[id]/order-actions.tsx                          | 2026-07-13                       | 2        |
| src/app/admin/orders/[id]/support-requests.tsx                       | 2026-07-08                       | 1        |
| src/app/layout.tsx                                                   | 2026-07-09（純 UI 版面）         | 1        |
| src/app/page.tsx                                                     | 2026-07-08（骨架＝T105）         | 1        |
| src/app/ui/page.tsx                                                  | 2026-07-09（UI kit 展示）        | 1        |
| src/app/global-error.tsx                                             | 2026-07-07（平行 session）       | 1        |
| src/instrumentation.ts                                               | 2026-07-07（平行 session）       | 1        |
| src/instrumentation-client.ts                                        | 2026-07-07（平行 session）       | 1        |
| src/proxy.ts                                                         | 2026-07-22                       | 2        |
| src/lib/auth/require-user.ts                                         | 2026-07-03                       | 1        |
| src/lib/auth/find-or-create-member.ts                                | 2026-07-13                       | 3        |
| src/lib/cart/read-cart.ts                                            | 2026-07-22                       | 2        |
| src/lib/cart/get-cart-count.ts                                       | 2026-07-22                       | 2        |
| src/lib/checkout/schema.ts                                           | 2026-07-15                       | 3        |
| src/lib/account/schema.ts                                            | 2026-07-07                       | 1        |
| src/lib/order/state-machine.ts                                       | 2026-07-22                       | 4        |
| src/lib/order/order-status.ts                                        | 2026-07-04                       | 1        |
| src/lib/pii/audit.ts                                                 | 2026-07-09（T80 落表複核）       | 2        |
| src/lib/pii/mask.ts                                                  | 2026-07-07                       | 1        |
| src/lib/rate-limit.ts                                                | 2026-07-15                       | 3        |
| src/lib/get-client-ip.ts                                             | 2026-07-10（首次，T78）          | 1        |
| src/lib/cart/touch-cart-updated-at.ts                                | 2026-07-10（首次，T78）          | 1        |
| src/app/api/cron/cart-cleanup/route.ts                               | 2026-07-10（首次，T78）          | 1        |
| src/lib/env.server.ts                                                | 2026-07-15                       | 3        |
| src/lib/env.ts                                                       | 2026-07-07                       | 1        |
| src/lib/supabase/client.ts                                           | 2026-07-08                       | 1        |
| src/lib/supabase/server.ts                                           | 2026-07-07                       | 1        |
| src/lib/supabase/service-role.ts                                     | 2026-07-07                       | 1        |
| src/lib/utils.ts                                                     | 2026-07-08                       | 1        |
| src/components/checkout-form.tsx                                     | 2026-07-07                       | 1        |
| src/components/product-configurator.tsx                              | 2026-07-08                       | 2        |
| src/components/support-request-form.tsx                              | 2026-07-08                       | 1        |
| src/components/cart-item-row.tsx                                     | 2026-07-08                       | 1        |
| src/components/profile-form.tsx                                      | 2026-07-08                       | 1        |
| src/components/account-nav.tsx                                       | 2026-07-08                       | 1        |
| src/components/ecpay-auto-submit.tsx                                 | 2026-07-07                       | 1        |
| src/components/site-header.tsx                                       | 2026-07-08                       | 1        |
| src/components/site-footer.tsx                                       | 2026-07-08                       | 1        |
| src/components/ui/button.tsx                                         | 2026-07-09（純 UI 元件）         | 1        |
| src/types/database.types.ts                                          | 未審查（生成檔）                 | 0        |
| types/supabase.ts                                                    | 2026-07-07（發現為殘留檔→F-013） | 1        |
| supabase/migrations/0001_initial_schema.sql                          | 2026-07-08（首次逐行）           | 1        |
| supabase/migrations/0002_enable_rls_and_policies.sql                 | 2026-07-08（首次逐行）           | 1        |
| supabase/migrations/0003_add_zip_code_to_orders.sql                  | 2026-07-08                       | 1        |
| supabase/seed.sql                                                    | 2026-07-08                       | 1        |
| next.config.ts                                                       | 2026-07-13                       | 2        |
| vercel.json                                                          | 2026-07-13                       | 3        |
| src/app/admin/orders/checkout/actions.ts                             | 2026-07-13（首次，T111）         | 1        |
| src/app/admin/orders/checkout/page.tsx                               | 2026-07-13（首次，T111）         | 1        |
| src/lib/order/create-order-from-cart.ts                              | 2026-07-15                       | 2        |
| src/lib/cron/require-cron-auth.ts                                    | 2026-07-13（首次，T78/T111）     | 1        |
| src/lib/admin/action-result.ts                                       | 2026-07-13（首次，T09）          | 1        |
| src/lib/concurrency-message.ts                                       | 2026-07-13（首次，T92）          | 1        |
| src/app/admin/layout.tsx                                             | 2026-07-13（首次，T09）          | 1        |
| src/app/admin/products/actions.ts                                    | 2026-07-15                       | 2        |
| src/lib/product/schema.ts                                            | 2026-07-13（首次，T10）          | 1        |
| src/lib/product/product-status.ts                                    | 2026-07-13（首次，T10）          | 1        |
| src/lib/product/category-labels.ts                                   | 2026-07-13（首次，T10）          | 1        |
| src/app/admin/products/[id]/images/actions.ts                        | 2026-07-13（首次，T11）          | 1        |
| src/lib/storage/product-images.ts                                    | 2026-07-13（首次，T11）          | 1        |
| src/lib/storage/constants.ts                                         | 2026-07-13（首次，T11）          | 1        |
| src/lib/auth/normalize-email.ts                                      | 2026-07-13（首次，T71）          | 1        |
| src/app/api/cron/pending-payment-expire/route.ts                     | 2026-07-13（首次，T66）          | 1        |
| supabase/migrations/0010_orders_cart_id_and_create_order_rpc.sql     | 2026-07-13（首次，T75/T76）      | 1        |
| supabase/migrations/0011_order_payment_hardening.sql                 | 2026-07-13（首次）               | 1        |
| supabase/migrations/0012_product_images.sql                          | 2026-07-13（首次，T11）          | 1        |
| supabase/migrations/0013_product_image_sort_integrity.sql            | 2026-07-13（首次，T11）          | 1        |
| src/lib/ecpay/aes-payload.ts                                         | 2026-07-15（首次，T42）          | 1        |
| src/lib/ecpay/invoice/invoice-client.ts                              | 2026-07-15（首次，T42）          | 1        |
| src/lib/ecpay/invoice/issue.ts                                       | 2026-07-15（首次，T42）          | 1        |
| src/lib/ecpay/invoice/validate.ts                                    | 2026-07-15（首次，T42）          | 1        |
| src/lib/ecpay/invoice/relate-number.ts                               | 2026-07-15（首次，T42）          | 1        |
| src/lib/order/issue-invoice.ts                                       | 2026-07-15（首次，T42）          | 1        |
| src/lib/order/invoice-meta.ts                                        | 2026-07-15（首次，T42）          | 1        |
| src/lib/order/order-access-token.ts                                  | 2026-07-15（首次，T73）          | 1        |
| src/lib/notification/senders.ts                                      | 2026-07-22                       | 2        |
| src/lib/option/schema.ts                                             | 2026-07-15（首次，T12）          | 1        |
| src/lib/product/product-option-schema.ts                             | 2026-07-15（首次，T13）          | 1        |
| src/app/admin/options/actions.ts                                     | 2026-07-15（首次，T12）          | 1        |
| src/app/admin/products/[id]/options/actions.ts                       | 2026-07-15（首次，T13）          | 1        |
| src/app/collections/[category]/page.tsx                              | 2026-07-15（首次，T14）          | 1        |
| supabase/migrations/0014_option_crud_support.sql                     | 2026-07-15（首次，T12）          | 1        |
| supabase/migrations/0015_product_option_crud_support.sql             | 2026-07-15（首次，T13）          | 1        |
| supabase/migrations/0016_order_invoice_meta.sql                      | 2026-07-15（首次，T42）          | 1        |
| src/app/admin/page.tsx                                               | 2026-07-16（首次，T09）          | 1        |
| src/app/admin/products/page.tsx                                      | 2026-07-16（首次，T10）          | 1        |
| src/app/admin/products/new/page.tsx                                  | 2026-07-16（首次，T10）          | 1        |
| src/app/admin/products/[id]/page.tsx                                 | 2026-07-16（首次，T10）          | 1        |
| src/app/admin/products/[id]/images/page.tsx                          | 2026-07-16（首次，T11）          | 1        |
| src/app/admin/products/[id]/images/image-manager.tsx                 | 2026-07-16（首次，T11）          | 1        |
| src/app/admin/products/[id]/options/page.tsx                         | 2026-07-16（首次，T13）          | 1        |
| src/app/admin/products/[id]/options/product-options-manager.tsx      | 2026-07-16（首次，T13）          | 1        |
| src/app/admin/options/page.tsx                                       | 2026-07-16（首次，T12）          | 1        |
| src/app/admin/options/[id]/page.tsx                                  | 2026-07-16（首次，T12）          | 1        |
| src/app/admin/options/[id]/option-type-detail.tsx                    | 2026-07-16（首次，T12）          | 1        |
| src/app/admin/options/create-option-type-form.tsx                    | 2026-07-16（首次，T12）          | 1        |
| src/app/admin/orders/[id]/invoice-section.tsx                        | 2026-07-16（首次，T42）          | 1        |
| src/app/collections/page.tsx                                         | 2026-07-16（首次，T14）          | 1        |
| src/app/checkout/rate-limited-notice.tsx                             | 2026-07-16（首次，T73）          | 1        |
| src/app/account/orders/loading.tsx                                   | 2026-07-16（首次）               | 1        |
| src/app/account/orders/[id]/loading.tsx                              | 2026-07-16（首次）               | 1        |
| src/app/cart/loading.tsx                                             | 2026-07-16（首次）               | 1        |
| src/app/checkout/loading.tsx                                         | 2026-07-16（首次）               | 1        |
| src/app/collections/[category]/loading.tsx                           | 2026-07-16（首次）               | 1        |
| src/app/products/[slug]/loading.tsx                                  | 2026-07-16（首次）               | 1        |
| src/components/admin-checkout-form.tsx                               | 2026-07-16（首次，T111）         | 1        |
| src/components/admin-product-form.tsx                                | 2026-07-16（首次，T10）          | 1        |
| src/components/admin-nav.tsx                                         | 2026-07-16（首次，T09）          | 1        |
| src/components/admin-notify.tsx                                      | 2026-07-16（首次，T12）          | 1        |
| src/components/admin-pill.tsx                                        | 2026-07-16（首次，T11）          | 1        |
| src/components/admin-filter-pills.tsx                                | 2026-07-16（首次，T10）          | 1        |
| src/components/product-card.tsx                                      | 2026-07-16（首次，T14）          | 1        |
| src/components/breadcrumb.tsx                                        | 2026-07-16（首次，T14）          | 1        |
| src/components/collection-sort-select.tsx                            | 2026-07-16（首次，T14）          | 1        |
| src/components/placeholder-image.tsx                                 | 2026-07-16（首次）               | 1        |
| src/components/mobile-nav.tsx                                        | 2026-07-16（首次，T40）          | 1        |
| src/components/saved-banner.tsx                                      | 2026-07-16（首次，T10）          | 1        |
| src/components/ui/skeleton.tsx                                       | 2026-07-16（首次）               | 1        |
| src/lib/option/labels.ts                                             | 2026-07-16（首次，T12）          | 1        |
| src/lib/product/collection-sort.ts                                   | 2026-07-16（首次，T14）          | 1        |
| src/lib/product/option-type-codes.ts                                 | 2026-07-16（首次，T14）          | 1        |
| src/lib/zod/flatten-field-errors.ts                                  | 2026-07-16（首次，T10）          | 1        |
| vitest.config.ts                                                     | 2026-07-16（首次）               | 1        |
| supabase/migrations/0017_transition_order_status_rpc.sql             | 2026-07-22（首次，T110）         | 1        |
| supabase/migrations/0018_cart_member_unique.sql                      | 2026-07-22（首次，T81）          | 1        |
| supabase/migrations/0019_support_request_status_check.sql            | 2026-07-22（首次，T47）          | 1        |
| supabase/migrations/0020_refund_order_rpc.sql                        | 2026-07-22（首次，T47）          | 1        |
| supabase/migrations/0021_repair_refunded_payment_rpc.sql             | 2026-07-22（首次，T47）          | 1        |
| src/lib/order/refund-order.ts                                        | 2026-07-22（首次，T47）          | 1        |
| src/lib/order/find-paid-payment.ts                                   | 2026-07-22（首次，T47/T127）     | 1        |
| src/lib/order/mark-pending-payments-failed.ts                        | 2026-07-22（首次，T127）         | 1        |
| src/lib/order/shipping-tracking.ts                                   | 2026-07-22（首次，T108）         | 1        |
| src/lib/ecpay/validate-settle-amount.ts                              | 2026-07-22（首次，T127）         | 1        |
| src/lib/cart/resolve-cart-identity.ts                                | 2026-07-22（首次，T81）          | 1        |
| src/lib/cart/get-or-create-member-cart.ts                            | 2026-07-22（首次，T81）          | 1        |
| src/lib/cart/guest-token.ts                                          | 2026-07-22（首次，T133）         | 1        |
| src/lib/cart/merge-guest-cart.ts                                     | 2026-07-22（首次，T81）          | 1        |
| src/lib/product/check-product-availability.ts                        | 2026-07-22（首次，T117）         | 1        |
| src/lib/product/start-price.ts                                       | 2026-07-22（首次，T59）          | 1        |
| src/lib/email/order-refunded-notification.ts                         | 2026-07-22（首次，T47/T87）      | 1        |
| src/lib/seo/site-url.ts                                              | 2026-07-22（首次，T59）          | 1        |
| src/app/sitemap.ts                                                   | 2026-07-22（首次，T59）          | 1        |
| src/app/robots.ts                                                    | 2026-07-22（首次，T59）          | 1        |

> 註（2026-07-22）：本輪逐行審 2026-07-16（b913ae9）以來 PR #86～#115 的大 delta——**T47 記錄式退款鏈**（`refund-order.ts`＋migration 0020 `refund_order` 原子 RPC〔翻 paid payment＋CAS 轉 refunded＋稽核 log 單一交易，CAS miss `raise U0002` 整筆 rollback〕＋0021 `repair_refunded_payment`〔Override 半套狀態原子補登記〕＋`find-paid-payment.ts`〔findPaidPayment／findRefundablePayment 單一出處〕＋`mark-pending-payments-failed.ts`＋`order-refunded-notification.ts`〔escapeHtml 齊全〕＋admin `refundOrderAction`）、**T110 狀態機交易化**（migration 0017 `transition_order_status` RPC＋`state-machine.ts` 三守衛：取消守衛/退款守衛〔`!findPaidPayment`〕/override to===from 擋、post-cancel TOCTOU 複查）、**T81 購物車身分重構**（`resolve-cart-identity.ts` identity invariant〔登入態絕不 fallback guest token〕＋`get-or-create-member-cart.ts`＋`merge-guest-cart.ts` 的 CAS 佔位/搬列/optimistic 刪殼 orphan-free＋migration 0018 `uq_cart_member`）、**T127 對帳鏈擴充**（`ecpay-reconcile/route.ts` 漂移臂/paid-on-cancelled/paid-on-refunded durable 稽核臂＋`validate-settle-amount.ts` 單一出處）、**notify route**（refunded 終態良性回 1|OK、T74 rescue、after() 發票）、**proxy.ts**（T133 guest_token 預簽＋CSP nonce）、**T117**（`check-product-availability.ts` service-role fail-open UX 判斷，verify-prices 必選完整性兜底已驗）、**T59 SEO**（sitemap/robots/site-url，force-dynamic 杜絕 promote-preview 凍結、§6 查詢失敗 throw）。**核心金流／退款／狀態機／併發／通知路徑品質極高**——RPC 一律 revoke execute＋釘 search_path、Supabase `{error}` 全解構、CAS SET 改動 WHERE 欄位（§6）、sendOnce 絕不 throw＋eligibleStatuses〔order_refunded=["refunded"]〕對齊 sweep、identity invariant 一致。兩遍式：第一遍對抗性問題集 §6「numeric 轉換點」揪出 F-025（addToCart 算術未 `Number()`，反證顯示目前回 number 故 latent 不觸發、結帳端 fail-safe，P2）；flow 範圍 `pnpm audit`（端點已恢復）揪出 F-026（`shadcn` 誤列 dependencies 把 hono 拉進 prod 依賴樹，P2）。第二遍 code/schema checklist 回歸：A（驗價/退款金額）B（CAS 冪等）C（tracking/trade-no 單一出處）D（requireAdmin 齊全/refund server-side 防旁路）F（{error} 處理）G（RPC 機制皆有使用點）S1〔uq_cart_member〕S4〔support_request text+check〕S7〔RPC 使用點〕S9〔新增不改舊、search_path〕全數乾淨，無 P0/P1、無 schema 新發現。測試檔（本輪新增 `refund-order.test.ts`／`merge-guest-cart.test.ts`／`resolve-cart-identity.test.ts`／`get-or-create-member-cart.test.ts`／`proxy.test.ts`／`validate-settle-amount.test.ts`／`check-product-availability.test.ts`／`find-paid-payment.test.ts` 等）不計入覆蓋表。跳過 env 範圍（本環境無 supabase／vercel 憑證）。

> 註（2026-07-16）：`src/`／`supabase/` 自上輪（commit b913ae9）**零變動**，本輪無 delta 可複核，價值全在**覆蓋輪替結案**——逐行補審 39 支從未逐行審過的展示層／純 helper 檔（admin 商品／選項 CRUD 全部 server pages＋client forms＋`useAdminAction` 共用 hook＋前台展示元件＋6 支 loading 骨架＋`vitest.config`），**全數乾淨、無 P0/P1/P2 發現**。關鍵回歸：admin server pages 對 Supabase `{error}` 皆解構＋throw（F-017 根因未擴散至 admin 層）、uuid 先驗避免 cast→500、`requireAdmin()` 齊全（D3）；client 端 swatchHex／gemColor 注入 inline style 前皆格式守衛或用 React object-form（無 CSS 注入）、mutation 全走已審 server action 二次驗證。至此覆蓋母集僅剩 `src/types/database.types.ts`（生成檔，免審）審查次數為 0。測試檔不計入覆蓋表。

> 註（2026-07-15）：本輪逐行審 PR #64（T73）／#65（T13）／#62（T12）／#61（T14）／#66（T88）／#68（T42 電子發票）／#67（T107）＋ migration 0014–0016 delta。首次入表 17 支業務邏輯／schema 檔（發票鏈 7 支＋`order-access-token.ts`＋`senders.ts`＋`option/schema.ts`＋`product-option-schema.ts`＋admin options actions 兩支＋`collections/[category]/page.tsx`＋migration 0014–0016）＋複核既有金流鏈與結帳鏈（notify／ecpay-reconcile／ensure-paid／send-once／verify-prices／checkout actions／pay 頁／create-order-from-cart／rate-limit／checkout schema／env.server／products actions／admin products actions）。T42 發票鏈品質優異、T73／T107／T88 修法複核正確；新發現 F-024（T42 發票驗證 API 在限流／cart 讀取之前呼叫，P2）。**尚未逐行審**：T42／T12/T13/T14 展示層與純 helper（`collection-sort-select`／`product-card`／`breadcrumb`／`placeholder-image`／admin options/products options 頁面群＋form 元件／`lib/option/labels`／`lib/product/{collection-sort,option-type-codes,category-labels,product-status}`），留下輪輪替（見老化提醒）。測試檔（本輪新增 `invoice-client.test.ts`／`issue.test.ts`／`validate.test.ts`／`aes-payload.test.ts`／`issue-invoice.test.ts`／`order-access-token.test.ts` 等）不計入覆蓋表。`pnpm audit` 端點已退役（410）無法執行——T94 已釘 postcss>=8.5.10。

> 註（2026-07-07）：本輪聚焦 PR #31／#32／#33 delta（Sentry／出貨通知信／T89 對帳鏈）＋大規模輪替補審 20+ 支未審檔（checkout 鏈前端、cart 讀取、auth confirm、account actions、supabase server/service-role、env 兩支、next.config、vercel.json、pii/mask、admin order-actions、checkout-form 等）。測試檔（`__tests__`／`*.test.ts`）不計入覆蓋表。已移除歷史誤植列 `src/app/api/ecpay/aio-payment（見 …）`。

> 註（2026-07-08）：`src/` 自 PR #33 起無變動；本輪把覆蓋輪替推向剩餘的 schema `0001`／`0002`／`0003`＋`seed.sql`（schema 範圍首次逐行）與 account／PDP／純 UI 展示層共 24 檔。至此覆蓋表僅 `layout.tsx`／`ui/page.tsx`／`ui/button.tsx`／`database.types.ts`（生成檔）審查次數仍為 0，皆無業務邏輯。schema 三支複核結論：enum／RESTRICT 帳務鏈／RLS deny-by-default／`revoke delete` 帳務四表／`updated_at` trigger（append-only 表除外）／FK 與查詢索引齊全；partial unique `uq_payment_one_paid_per_order`、`raw_callback`、`gateway_trade_no`、`last_reconciled_at` 皆有程式使用點，無 S7/G1 機制虛設，本輪無新 schema 發現。

> 註（2026-07-09）：本輪逐行複核三支 PR delta（T70／T80／T86）並補審其新檔（`safe-redirect.ts`、migration `0008`／`0009`）＋收尾 3 支從未審過的純 UI 檔（`layout.tsx`／`ui/page.tsx`／`ui/button.tsx`）。至此覆蓋表僅 `src/types/database.types.ts`（Supabase 自動生成）審查次數仍為 0——無需人工逐行審。T80／T86 複核正確、F-005 改已修復；新發現 F-020（addToCart insert-first 與 §3.2 read-first 教訓相反，P2）。測試檔（`__tests__`／`*.test.ts`：本輪新增 `add-to-cart.test.ts`／`safe-redirect.test.ts`／`audit.test.ts`）不計入覆蓋表。

> 註（2026-07-13）：本輪逐行審 PR #57（T111 代客建單）／#56（T09）／#59（T10）／#60（T11）＋ migration 0010–0013 delta——首次入表 20 支業務邏輯／schema 檔（admin actions 三支、`create-order-from-cart.ts`、`require-cron-auth.ts`、`product/{schema,product-status,category-labels}.ts`、`storage/{product-images,constants}.ts`、`normalize-email.ts`、`admin/{layout,orders/checkout/page}.tsx`、`admin/action-result.ts`、`concurrency-message.ts`、`pending-payment-expire/route.ts`、migration 0010–0013）＋複核既有金流鏈與 admin 修復（notify／ensure-paid／checkout actions／pay 頁／state-machine／admin/orders/[id]/actions／find-or-create-member／require-admin／next.config／vercel.json／order-shipped/order-actions）。新程式全數 `requireAdmin()` 把關（D3 齊全）、magic-byte 圖片內容檢查、RPC 原子化取號／交換／建單、`create_order_with_items` revoke execute＋釘 search_path 皆到位，無 P0/P1；新發現 F-023（T111 付款連結 order_no 憑證化，與 T73 pay 頁擁有權綁定計畫衝突，P2）。**尚未逐行審**：T09/T10/T11/T111 展示層與純 helper（`admin-*.tsx`／`admin-product-form`／`image-manager`／`mobile-nav`／`flatten-field-errors`／admin/products 頁面群／loading 骨架等，見老化提醒），留下輪輪替。測試檔（本輪新增 `create-admin-order.test.ts`／`admin/products/__tests__/actions.test.ts`／`storage/__tests__/product-images.test.ts`／`create-order-from-cart.test.ts`／`pending-payment-expire/__tests__/route.test.ts` 等）不計入覆蓋表；image actions（uploadImage/deleteImage/moveImage）目前無專屬測試（RPC 邏輯在 DB 端）。

> 註（2026-07-10）：本輪逐行審 PR #46（T78）delta——變更檔 `cart/actions.ts`／`products/[slug]/actions.ts`／`checkout/actions.ts`／`login/actions.ts`／`rate-limit.ts` 與 3 支新檔（`api/cron/cart-cleanup/route.ts`／`lib/cart/touch-cart-updated-at.ts`／`lib/get-client-ip.ts`，皆首次入表）＋覆蓋輪替補審最久未審的 `check-mac-value.ts`／`support/actions.ts`／`support-request.ts`。T78 複核大致正確、隨手修好 OTP ratelimit prefix 共用 key 的既有潛伏 bug；新發現 F-021／F-022（皆 P2-low，cart-cleanup），F-017 追加 `support/actions.ts` location。覆蓋表僅剩 `database.types.ts`（生成檔）＝0。測試檔（本輪新增 `cart/__tests__/actions.test.ts`）不計入覆蓋表。cart-cleanup route 目前無測試（見 F-022 附註）。
