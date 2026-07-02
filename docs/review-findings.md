# 開發審查發現（review-findings.md）

> 本檔是 dev-review skill 的工作底稿與唯一累積點：無人值守執行時自動寫入，不動 tasks.csv、不開 issues。
> **只有使用者能把狀態改成「確認」或「不採納」**；經確認的項目才由後續 session 轉入 tasks.csv＋GitHub issues。
> F 編號永久遞增不重用。

## 審查記錄

| 日期       | 範圍                                       | 模型            | 新發現       | 備註                                                                                                                                                         |
| ---------- | ------------------------------------------ | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-02 | code＋schema＋flow（跳過 env，無雲端憑證） | claude-opus-4-8 | F-001～F-004 | 首份 review-findings.md；對抗性＋類別清單兩遍式。money chain 既有問題 T67–T83 逐一確認仍在列管（見末尾回歸狀態）。本次聚焦 T33 售後新程式與 T65 快照 delta。 |

---

## F-001 [P1] 售後通知 Email 未跳脫客人自由輸入的「說明」→ 店家信箱 HTML／釣魚注入

- 狀態：已轉任務(T84)（使用者 2026-07-03 確認）
- 位置：`src/lib/email/support-request-notification.ts:71`（`${request.description}`）；同檔 `:63` recipient_name 亦未跳脫
- 失敗情境：任何登入會員在 `/account/orders/[id]/support` 的「說明」欄（自由文字，Zod／DB 上限 2000 字，內容完全由客人控制）填入 `</td></tr></table><a href="https://evil.example">請點此領取退款</a>` 之類的 HTML，送出後 `sendSupportRequestNotification` 直接把該字串以樣板字串插進信件 HTML（無跳脫），寄到店家信箱 `fishead02290@gmail.com`。店家收到的信會渲染攻擊者植入的任意 HTML／釣魚連結／偽造版面，可被用於社交工程（誘導店家點惡意連結或誤把退款匯到他處）。`description` 是全站最「純攻擊者可控」的欄位——它就是一個給客人自由打字的大文字框。全專案 grep 無任何 `escapeHtml`／`sanitize` 函式（三支寄信程式都靠樣板字串直插）。
- 修法：新增共用 `escapeHtml()`（替換 `& < > " '`），套用到本檔所有插值（`description`、`recipient_name`、`order_no`、`typeLabel`、`customerEmail`）。**與 T72 同一根本原因**（Email 模板 HTML 注入），但 T72 只點名 `order-confirmation.ts`／`new-order-notification.ts` 兩支，**未涵蓋 T33 後新增的第三支 `support-request-notification.ts`**——修 T72 時務必把共用 escape 一併套到本檔，否則注入仍在。建議與 T72 合併為同一批修復並互相註記。
- 記錄：2026-07-02 首次發現（本檔第一輪）。T33（2026-07-02 完成）新增本寄信程式，晚於產生 T72 的那次審查，故未被 T72 涵蓋。

## F-002 [P2] 售後申請無限流、無去重：登入客人可灌爆店家信箱與 support_request 表

- 狀態：待確認
- 位置：`src/app/account/orders/[id]/support/actions.ts:16`（`createSupportRequest`，無 rate limit、無「同單已申請」去重）
- 失敗情境：擁有一張 paid 訂單的登入會員，反覆呼叫 `createSupportRequest`（UI 重複點擊或直接 script server action）→ 每次都通過擁有權檢查、insert 一列 `support_request` 並 `await sendSupportRequestNotification` 寄一封信給店家。結果：店家信箱被同一張訂單的售後信洗版、`support_request` 表無上限膨脹。相較 T78（匿名可無限建 cart）本路徑需登入＋擁有真實 paid 訂單，濫用門檻較高，故列 P2。
- 修法：對 `createSupportRequest` 加速率限制（`src/lib/rate-limit.ts` 已有 Upstash 基礎設施，可用 memberId＋orderId 當 key）；或加「同訂單 pending 期間僅允許一筆」的去重（查現有 open 案件即拒新增，引導客人回覆既有信件）。與 T78 同屬「高成本／可灌爆寫入路徑缺限流」（code-checklist G3）。
- 記錄：2026-07-02 首次發現。

## F-003 [P2] 相依套件 postcss 8.4.31 有 moderate XSS 公告（CVE-2026-41305）

- 狀態：待確認
- 位置：`pnpm-lock.yaml`（`next > postcss@8.4.31`，transitive）；`pnpm audit` 回報
- 失敗情境：`pnpm audit` 顯示 postcss < 8.5.10 有 GHSA-qx2v-qp2m-jg93（stringify 輸出未跳脫 `</style>`，CVSS 6.1）。**實際可利用性對本專案極低**——該漏洞需「解析使用者提交的 CSS 再嵌回 HTML `<style>`」，本站不處理使用者 CSS，postcss 僅在 build 期經 Next 的 CSS 管線使用。列此項是因 CLAUDE.md §2 明文「不主動升級相依套件，除非為修補安全漏洞」——安全公告屬該例外，故登記追蹤。
- 修法：postcss 為 next 的 transitive 依賴，無法單獨升級；可用 pnpm `overrides`／`pnpm.overrides` 釘 `postcss@>=8.5.10`，或等 Next 補丁版一併帶入後執行 `pnpm audit` 確認清零。升級後跑 `pnpm build` 驗證 CSS 管線無回歸。
- 記錄：2026-07-02 首次發現（flow 範圍依賴安全掃描）。

## F-004 [P2] 最關鍵路徑（webhook、createOrder）無任何自動化測試，修復易靜默回歸

- 狀態：已轉任務(T85)（使用者 2026-07-03 確認）
- 位置：`src/app/api/ecpay/notify/route.ts`、`src/app/checkout/actions.ts`（皆無對應測試；現有測試僅 `verify-prices.test.ts`／`state-machine.test.ts`／`support/*.test.ts`／`pii/mask.test.ts`）
- 失敗情境：notify webhook 是全專案最關鍵檔案（驗章、冪等、狀態守衛、金額核對），createOrder 是建單金額鏈；兩者都沒有自動化測試。當 T67／T68／T69（已列管待修，都會改動這兩條路徑）落地時，像「例外分支誤回 `1|OK`」「冪等重複時重寄信」「slice 邊界」這類回歸不會被任何測試攔下，只能靠人工或客人踩到才發現。
- 修法：為 notify 補整合測試（CheckMacValue 驗章失敗→`0|Error`；RtnCode=1 且 pending→轉 paid 且冪等第二次呼叫不重複副作用；金額核對）；為 createOrder 補測試（驗價變動→不建單回 priceUpdated；order_no 碰撞重試；明細失敗處理）。建議在動 T67／T68／T69 之前先補，讓修復有回歸網。屬品質改善（P2），非上線硬阻擋，但與那三項 P0 修復高度相關。
- 記錄：2026-07-02 首次發現（flow 範圍測試覆蓋檢視）。

---

## 既有列管任務回歸狀態（2026-07-02 確認仍在列管、未修）

本輪走讀 money chain 與購物車／auth／email，逐一確認下列既有審查任務（T67–T83／GitHub #9–#25）皆**尚未修復、仍有效**，依去重規則不重報：

- **T67（#9, P0）** `order-result/route.ts:14` 仍為 `slice(11)`（未改 `slice(11,17)`）→ 付款客人被導回首頁。**確認仍在。**
- **T68（#10, P0）** `notify/route.ts:142-143` 外層 catch 仍回 `OK()`（`1|OK`）；標記 paid 前仍未核對 `TradeAmt` 與 `payment.amount`。**確認仍在。**
- **T69（#11, P0）** notify 兩處寄信仍為 `void send...().catch(()=>{})`（serverless 凍結風險）；notification 去重表全程零寫入。**確認仍在。**
- **T70（#12, P0）** cart.guest_token 仍無 unique 約束，`addToCart` 仍 check-then-insert。**確認仍在。**
- **T71（#13, P1）** `checkout/actions.ts:82-89` 訪客結帳仍憑未驗證 email 綁既有會員。**確認仍在。**
- **T72（#14, P1）** 三支寄信程式仍無 escape（本輪並發現 F-001 為其未涵蓋的第三支）。**確認仍在，且範圍擴大→見 F-001。**
- **T73（#15, P1）** 成功頁仍憑 order_no 揭露個資；`generateOrderNo` 仍用 `Math.random`（`checkout/actions.ts:24`）。**確認仍在。**
- **T74（#16, P1）** `pay/page.tsx:51-63` 仍復用 pending payment 的 trade no、無逾時換號。**確認仍在。**
- **T75（#17, P1）** `checkout/actions.ts:215` 仍在建單當下清購物車。**確認仍在。**
- **T76–T81（#18–#23, P2）** 訂單交易化、shipOrder 順序、cart 限流、findOrCreateMember 吞錯、PII log 留存、cart.member_id 未用——本輪未見修復跡象。**確認仍在。**
- **T82（#25, P0）／T83（P0）** 環境設定（Vercel env 分離／Supabase Auth production）——本輪跳過 env 範圍（無憑證），依既有列管，不變。
- schema 範圍：migrations 0003–0006 逐一檢視，皆遵循帳務鏈 RESTRICT／RLS deny-by-default／revoke delete／updated_at trigger／FK 索引慣例（0006 support_request 尤其齊全）；**本輪無新 schema 發現。**

---

## 老化提醒

- **待確認超過 14 天的發現**：無（本檔首建，F-001～F-004 均為 2026-07-02 新增）。
- **從未審查過的檔案（覆蓋表中審查次數＝0）**：見下方覆蓋表，本輪首建，多數檔案尚未納入正式審查輪替（詳列於表）。後續審查依 code-checklist 步驟 0.3 每輪補抽最久未審的 5 個。

---

## 檔案覆蓋表

> 母集＝`git ls-files` 排除純資產。「審查次數」自本檔首建（2026-07-02）起計；先前 2026-07-02 產生 T67–T83 的審查未留覆蓋表，故未計入。本輪實際逐行讀過者標日期＋1，其餘暫記 0（＝正式輪替尚未覆蓋，非零風險）。

| 路徑                                                                 | 最後審查日期             | 審查次數 |
| -------------------------------------------------------------------- | ------------------------ | -------- |
| src/app/api/ecpay/notify/route.ts                                    | 2026-07-02               | 1        |
| src/app/api/ecpay/order-result/route.ts                              | 2026-07-02               | 1        |
| src/app/checkout/actions.ts                                          | 2026-07-02               | 1        |
| src/app/checkout/pay/page.tsx                                        | 2026-07-02               | 1        |
| src/lib/quote/verify-prices.ts                                       | 2026-07-02               | 1        |
| src/lib/email/order-confirmation.ts                                  | 2026-07-02               | 1        |
| src/lib/email/new-order-notification.ts                              | 2026-07-02               | 1        |
| src/lib/email/support-request-notification.ts                        | 2026-07-02               | 1        |
| src/app/account/orders/[id]/support/actions.ts                       | 2026-07-02               | 1        |
| src/lib/support/support-request.ts                                   | 2026-07-02               | 1        |
| src/lib/support/schema.ts                                            | 2026-07-02               | 1        |
| src/app/admin/orders/[id]/actions.ts                                 | 2026-07-02               | 1        |
| src/lib/auth/require-admin.ts                                        | 2026-07-02               | 1        |
| supabase/migrations/0004_add_actor_to_order_status_log.sql           | 2026-07-02               | 1        |
| supabase/migrations/0005_add_product_name_snapshot_to_order_item.sql | 2026-07-02               | 1        |
| supabase/migrations/0006_add_support_request.sql                     | 2026-07-02               | 1        |
| src/app/api/ecpay/aio-payment（見 src/lib/ecpay/aio-payment.ts）     | 未審查                   | 0        |
| src/lib/ecpay/aio-payment.ts                                         | 未審查                   | 0        |
| src/lib/ecpay/check-mac-value.ts                                     | 未審查                   | 0        |
| src/lib/ecpay/merchant-trade-no.ts                                   | 未審查                   | 0        |
| src/app/checkout/success/page.tsx                                    | 未審查                   | 0        |
| src/app/checkout/success/order-status-check.tsx                      | 未審查                   | 0        |
| src/app/checkout/failed/page.tsx                                     | 未審查                   | 0        |
| src/app/checkout/page.tsx                                            | 未審查                   | 0        |
| src/app/cart/actions.ts                                              | 未審查                   | 0        |
| src/app/cart/page.tsx                                                | 未審查                   | 0        |
| src/app/products/[slug]/actions.ts                                   | 未審查                   | 0        |
| src/app/products/[slug]/page.tsx                                     | 未審查                   | 0        |
| src/app/login/actions.ts                                             | 未審查                   | 0        |
| src/app/login/page.tsx                                               | 未審查                   | 0        |
| src/app/auth/confirm/actions.ts                                      | 未審查                   | 0        |
| src/app/auth/confirm/page.tsx                                        | 未審查                   | 0        |
| src/app/account/actions.ts                                           | 未審查                   | 0        |
| src/app/account/layout.tsx                                           | 未審查                   | 0        |
| src/app/account/page.tsx                                             | 未審查                   | 0        |
| src/app/account/orders/page.tsx                                      | 未審查                   | 0        |
| src/app/account/orders/[id]/page.tsx                                 | 未審查                   | 0        |
| src/app/account/orders/[id]/support/page.tsx                         | 未審查                   | 0        |
| src/app/account/profile/actions.ts                                   | 未審查                   | 0        |
| src/app/account/profile/page.tsx                                     | 未審查                   | 0        |
| src/app/admin/orders/page.tsx                                        | 未審查                   | 0        |
| src/app/admin/orders/[id]/page.tsx                                   | 未審查                   | 0        |
| src/app/admin/orders/[id]/customer-info.tsx                          | 未審查                   | 0        |
| src/app/admin/orders/[id]/order-actions.tsx                          | 未審查                   | 0        |
| src/app/admin/orders/[id]/support-requests.tsx                       | 未審查                   | 0        |
| src/app/layout.tsx                                                   | 未審查                   | 0        |
| src/app/page.tsx                                                     | 未審查                   | 0        |
| src/app/ui/page.tsx                                                  | 未審查                   | 0        |
| src/proxy.ts                                                         | 未審查                   | 0        |
| src/lib/auth/require-user.ts                                         | 未審查                   | 0        |
| src/lib/auth/find-or-create-member.ts                                | 未審查                   | 0        |
| src/lib/cart/read-cart.ts                                            | 未審查                   | 0        |
| src/lib/cart/get-cart-count.ts                                       | 未審查                   | 0        |
| src/lib/checkout/schema.ts                                           | 未審查                   | 0        |
| src/lib/account/schema.ts                                            | 未審查                   | 0        |
| src/lib/order/state-machine.ts                                       | 未審查                   | 0        |
| src/lib/order/order-status.ts                                        | 未審查                   | 0        |
| src/lib/pii/audit.ts                                                 | 未審查                   | 0        |
| src/lib/pii/mask.ts                                                  | 未審查                   | 0        |
| src/lib/rate-limit.ts                                                | 未審查                   | 0        |
| src/lib/env.server.ts                                                | 未審查                   | 0        |
| src/lib/env.ts                                                       | 未審查                   | 0        |
| src/lib/supabase/client.ts                                           | 未審查                   | 0        |
| src/lib/supabase/server.ts                                           | 未審查                   | 0        |
| src/lib/supabase/service-role.ts                                     | 未審查                   | 0        |
| src/lib/utils.ts                                                     | 未審查                   | 0        |
| src/components/checkout-form.tsx                                     | 未審查                   | 0        |
| src/components/product-configurator.tsx                              | 未審查                   | 0        |
| src/components/support-request-form.tsx                              | 未審查                   | 0        |
| src/components/cart-item-row.tsx                                     | 未審查                   | 0        |
| src/components/profile-form.tsx                                      | 未審查                   | 0        |
| src/components/account-nav.tsx                                       | 未審查                   | 0        |
| src/components/ecpay-auto-submit.tsx                                 | 未審查                   | 0        |
| src/components/site-header.tsx                                       | 未審查                   | 0        |
| src/components/site-footer.tsx                                       | 未審查                   | 0        |
| src/components/ui/button.tsx                                         | 未審查                   | 0        |
| src/types/database.types.ts                                          | 未審查（生成檔）         | 0        |
| supabase/migrations/0001_initial_schema.sql                          | 未審查（本輪僅間接對照） | 0        |
| supabase/migrations/0002_enable_rls_and_policies.sql                 | 未審查（本輪僅間接對照） | 0        |
| supabase/migrations/0003_add_zip_code_to_orders.sql                  | 未審查                   | 0        |
| supabase/seed.sql                                                    | 未審查                   | 0        |
| next.config.ts                                                       | 未審查                   | 0        |

> 註：`aio-payment.ts`／`check-mac-value.ts`／`merchant-trade-no.ts` 屬金流鏈高風險，本輪因時間聚焦 T33 delta 未逐行讀（僅在 T67 脈絡對照 order-result／notify 的 slice 邏輯），列為下一輪優先補審對象。
