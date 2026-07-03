# 開發審查發現（review-findings.md）

> 本檔是 dev-review skill 的工作底稿與唯一累積點：無人值守執行時自動寫入，不動 tasks.csv、不開 issues。
> **只有使用者能把狀態改成「確認」或「不採納」**；經確認的項目才由後續 session 轉入 tasks.csv＋GitHub issues。
> F 編號永久遞增不重用。

## 審查記錄

| 日期       | 範圍                                       | 模型            | 新發現       | 備註                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------ | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-02 | code＋schema＋flow（跳過 env，無雲端憑證） | claude-opus-4-8 | F-001～F-004 | 首份 review-findings.md；對抗性＋類別清單兩遍式。money chain 既有問題 T67–T83 逐一確認仍在列管（見末尾回歸狀態）。本次聚焦 T33 售後新程式與 T65 快照 delta。                                                                                                                                                 |
| 2026-07-03 | code＋schema＋flow（跳過 env，無雲端憑證） | claude-opus-4-8 | F-005～F-006 | 排程審查。本輪依覆蓋表輪替補審**上輪未讀的金流鏈三支＋checkout success/failed/pay＋login/auth/proxy＋admin/account 存取控制**共 19 檔。程式自上輪（commit 2503267）起未變動，T67–T83 全數維持原狀。新發現 F-005（T73 根因未涵蓋 pay/failed 頁）、F-006（登入 redirect 開放轉址）皆為上輪未讀檔案暴露之缺口。 |

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

- 狀態：已修復（PR #29，2026-07-03；T85 完成）
- 位置：`src/app/api/ecpay/notify/route.ts`、`src/app/checkout/actions.ts`（皆無對應測試；現有測試僅 `verify-prices.test.ts`／`state-machine.test.ts`／`support/*.test.ts`／`pii/mask.test.ts`）
- 失敗情境：notify webhook 是全專案最關鍵檔案（驗章、冪等、狀態守衛、金額核對），createOrder 是建單金額鏈；兩者都沒有自動化測試。當 T67／T68／T69（已列管待修，都會改動這兩條路徑）落地時，像「例外分支誤回 `1|OK`」「冪等重複時重寄信」「slice 邊界」這類回歸不會被任何測試攔下，只能靠人工或客人踩到才發現。
- 修法：為 notify 補整合測試（CheckMacValue 驗章失敗→`0|Error`；RtnCode=1 且 pending→轉 paid 且冪等第二次呼叫不重複副作用；金額核對）；為 createOrder 補測試（驗價變動→不建單回 priceUpdated；order_no 碰撞重試；明細失敗處理）。建議在動 T67／T68／T69 之前先補，讓修復有回歸網。屬品質改善（P2），非上線硬阻擋，但與那三項 P0 修復高度相關。
- 記錄：2026-07-02 首次發現（flow 範圍測試覆蓋檢視）。

## F-005 [P1] 登入成功後開放轉址（open redirect）：`?redirect=` 未驗證即 `router.push`

- 狀態：已轉任務(T86)（使用者 2026-07-03 確認）
- 位置：`src/app/login/page.tsx:10`（`const redirectTo = searchParams.get("redirect") ?? "/"`）＋ `:35`（`router.push(redirectTo)`）
- 失敗情境：攻擊者對受害者發出釣魚連結 `https://<本站>/login?redirect=https://evil.example/phish`（或協定相對 `//evil.example`）。受害者看到的是**本站真實網域**的登入頁、輸入真實 OTP 完成登入，`handleVerify` 成功後直接 `router.push(redirectTo)` 把受害者導向 `https://evil.example/phish`。`redirectTo` 完全取自 URL query，無「必須是站內相對路徑」的驗證——`router.push` 收到絕對 URL／協定相對 URL 會導到外站。攻擊者藉此把「剛在正牌站完成登入」的信任接力到偽造頁（要求補資料、付款、或竊取後續 referrer），是典型登入流程釣魚放大器。注意 `require-user.ts:11` 產生的 `redirect` 參數本身取自 proxy 覆寫的 `x-pathname`（站內路徑、安全），但**登入頁不該假設該參數只會由自家產生**——任何人都能手打任意 `?redirect=`。
- 修法：在 `login/page.tsx` 對 `redirectTo` 做站內白名單：僅接受以單一 `/` 開頭且非 `//`（亦擋 `/\`）的相對路徑，否則退回 `"/"`。例：`const raw = searchParams.get("redirect"); const redirectTo = raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/"`。屬新缺陷類別「開放轉址」，建議審後補進 code-checklist（D 類信任邊界）。
- 記錄：2026-07-03 首次發現（本輪首次審 login/page.tsx、require-user.ts、proxy.ts 之 redirect 鏈）。

## F-006 [P2] T73 存取控制根因未涵蓋 `checkout/pay`、`checkout/failed` 兩頁（憑 order_no 讀單＋建 payment row）

- 狀態：已併入T73（使用者 2026-07-03 確認，T73 任務與 issue #15 已註記範圍擴至三頁）
- 位置：`src/app/checkout/pay/page.tsx:21-25`（憑 `order_no` service-role 讀單，無 session／擁有權綁定）＋ `:66-72`（為該單 insert 一列 pending `payment`）；`src/app/checkout/failed/page.tsx:15-19`（憑 `order_no` 讀 `order_no`/`status`）
- 失敗情境：T73 已列管「成功頁憑 order_no 揭露個資＋order_no 用 `Math.random` 可猜」，但其任務描述僅點名「**成功頁**綁 session／短效 cookie」。同一根因在 pay／failed 兩頁**未被涵蓋**：①`checkout/pay` 對任一可猜到的 `order_no` 直接以 service role 讀單，並把 `ItemName`（商品名＋數量）、`TotalAmount` 寫進可見的隱藏表單欄位（訂單明細外洩），且**會為別人的訂單 insert 一列 pending `payment`**（可被灌垃圾 payment row、或由第三方替他人發起付款）；②`checkout/failed` 憑 order_no 揭露 order_no＋status。三頁共用同一 order_no 即權限的缺口，若 T73 修法只補成功頁，pay／failed 仍開放——與 F-001／T72（修 escape 漏掉第三支寄信程式）完全同型的「同根因多點、修法只覆蓋一點」問題。
- 修法：把 T73 的存取控制修法（成功頁綁 session／短效 cookie／guest_token 或 member 歸屬）**一併套用到 `checkout/pay` 與 `checkout/failed`**，並在 pay 頁對「非本人訂單」拒絕讀取與 payment 建立。建議與 T73 同批修復並在 T73 任務／issue 註記「範圍含 pay／failed／success 三頁」。改 order_no 為 crypto 亂數（T73 已含）能降低猜測面，但**不可取代**擁有權綁定。
- 記錄：2026-07-03 首次發現（本輪首次逐行審 checkout/pay、success、failed 三頁）。

---

## 既有列管任務回歸狀態（2026-07-02 確認仍在列管、未修）

本輪走讀 money chain 與購物車／auth／email，逐一確認下列既有審查任務（T67–T83／GitHub #9–#25）皆**尚未修復、仍有效**，依去重規則不重報：

> **2026-07-03 排程審查再確認**：`git log` 顯示自上輪審查（commit `2503267`）後 `src/` 全無變動（其後皆 docs／skills commit），故 T67–T83 逐條維持原狀、位置行號不變。本輪新讀金流鏈三支＋checkout success/failed/pay＋login/auth/proxy＋admin/account，新增 F-005（開放轉址）、F-006（T73 根因未涵蓋 pay/failed）。

- **T67（#9, P0）** `order-result/route.ts:14` 仍為 `slice(11)`（未改 `slice(11,17)`）→ 付款客人被導回首頁。**確認仍在。**
- **T68（#10, P0）** `notify/route.ts:142-143` 外層 catch 仍回 `OK()`（`1|OK`）；標記 paid 前仍未核對 `TradeAmt` 與 `payment.amount`。**確認仍在。**
- **T69（#11, P0）** notify 兩處寄信仍為 `void send...().catch(()=>{})`（serverless 凍結風險）；notification 去重表全程零寫入。**確認仍在。**
- **T70（#12, P0）** cart.guest_token 仍無 unique 約束，`addToCart` 仍 check-then-insert。**確認仍在。**
- **T71（#13, P1）** `checkout/actions.ts:82-89` 訪客結帳仍憑未驗證 email 綁既有會員。**確認仍在。**
- **T72（#14, P1）** 三支寄信程式仍無 escape（本輪並發現 F-001 為其未涵蓋的第三支）。**確認仍在，且範圍擴大→見 F-001。**
- **T73（#15, P1）** 成功頁仍憑 order_no 揭露個資；`generateOrderNo` 仍用 `Math.random`（`checkout/actions.ts:24`）。**確認仍在。**（本輪並發現同根因未涵蓋 pay／failed 兩頁→見 F-006，修 T73 時範圍須擴至三頁。）
- **T74（#16, P1）** `pay/page.tsx:62-63`（現行行號）仍復用 pending payment 的 trade no、無逾時換號。**確認仍在。**
- **T75（#17, P1）** `checkout/actions.ts:215` 仍在建單當下清購物車。**確認仍在。**
- **T76–T81（#18–#23, P2）** 訂單交易化、shipOrder 順序、cart 限流、findOrCreateMember 吞錯、PII log 留存、cart.member_id 未用——本輪未見修復跡象。**確認仍在。**
- **T82（#25, P0）／T83（P0）** 環境設定（Vercel env 分離／Supabase Auth production）——本輪跳過 env 範圍（無憑證），依既有列管，不變。
- schema 範圍：migrations 0003–0006 逐一檢視，皆遵循帳務鏈 RESTRICT／RLS deny-by-default／revoke delete／updated_at trigger／FK 索引慣例（0006 support_request 尤其齊全）；**本輪無新 schema 發現。**

---

## 老化提醒

- **待確認超過 14 天的發現**：無。F-002／F-003 為 2026-07-02 新增（迄今 1 天）；F-005／F-006 為 2026-07-03 新增。
- **從未審查過的檔案（覆蓋表中審查次數＝0）**：本輪補審 19 檔後，仍有 **約 40 個檔案審查次數＝0**（詳見下方覆蓋表標「未審查」列，含 checkout/page.tsx、product-configurator.tsx、checkout-form.tsx、ecpay-auto-submit.tsx、account/profile 與 admin 子元件、rate-limit.ts、env.ts／env.server.ts、supabase client 三支、order/state-machine.ts、0001／0002 migration 等）。後續審查依 code-checklist 步驟 0.3 每輪續抽最久未審者；建議下一輪優先補 `env.server.ts`／`rate-limit.ts`／`state-machine.ts`／`checkout/page.tsx`／`product-configurator.tsx`。

---

## 檔案覆蓋表

> 母集＝`git ls-files` 排除純資產。「審查次數」自本檔首建（2026-07-02）起計；先前 2026-07-02 產生 T67–T83 的審查未留覆蓋表，故未計入。本輪實際逐行讀過者標日期＋1，其餘暫記 0（＝正式輪替尚未覆蓋，非零風險）。

| 路徑                                                                 | 最後審查日期             | 審查次數 |
| -------------------------------------------------------------------- | ------------------------ | -------- |
| src/app/api/ecpay/notify/route.ts                                    | 2026-07-02               | 1        |
| src/app/api/ecpay/order-result/route.ts                              | 2026-07-02               | 1        |
| src/app/checkout/actions.ts                                          | 2026-07-02               | 1        |
| src/app/checkout/pay/page.tsx                                        | 2026-07-03               | 2        |
| src/lib/quote/verify-prices.ts                                       | 2026-07-02               | 1        |
| src/lib/email/order-confirmation.ts                                  | 2026-07-02               | 1        |
| src/lib/email/new-order-notification.ts                              | 2026-07-02               | 1        |
| src/lib/email/support-request-notification.ts                        | 2026-07-02               | 1        |
| src/app/account/orders/[id]/support/actions.ts                       | 2026-07-02               | 1        |
| src/lib/support/support-request.ts                                   | 2026-07-02               | 1        |
| src/lib/support/schema.ts                                            | 2026-07-02               | 1        |
| src/app/admin/orders/[id]/actions.ts                                 | 2026-07-03               | 2        |
| src/lib/auth/require-admin.ts                                        | 2026-07-03               | 2        |
| supabase/migrations/0004_add_actor_to_order_status_log.sql           | 2026-07-02               | 1        |
| supabase/migrations/0005_add_product_name_snapshot_to_order_item.sql | 2026-07-02               | 1        |
| supabase/migrations/0006_add_support_request.sql                     | 2026-07-02               | 1        |
| src/app/api/ecpay/aio-payment（見 src/lib/ecpay/aio-payment.ts）     | 未審查                   | 0        |
| src/lib/ecpay/aio-payment.ts                                         | 2026-07-03               | 1        |
| src/lib/ecpay/check-mac-value.ts                                     | 2026-07-03               | 1        |
| src/lib/ecpay/merchant-trade-no.ts                                   | 2026-07-03               | 1        |
| src/app/checkout/success/page.tsx                                    | 2026-07-03               | 1        |
| src/app/checkout/success/order-status-check.tsx                      | 未審查                   | 0        |
| src/app/checkout/failed/page.tsx                                     | 2026-07-03               | 1        |
| src/app/checkout/page.tsx                                            | 未審查                   | 0        |
| src/app/cart/actions.ts                                              | 2026-07-03               | 1        |
| src/app/cart/page.tsx                                                | 未審查                   | 0        |
| src/app/products/[slug]/actions.ts                                   | 2026-07-03               | 1        |
| src/app/products/[slug]/page.tsx                                     | 未審查                   | 0        |
| src/app/login/actions.ts                                             | 2026-07-03               | 1        |
| src/app/login/page.tsx                                               | 2026-07-03               | 1        |
| src/app/auth/confirm/actions.ts                                      | 未審查                   | 0        |
| src/app/auth/confirm/page.tsx                                        | 未審查                   | 0        |
| src/app/account/actions.ts                                           | 未審查                   | 0        |
| src/app/account/layout.tsx                                           | 未審查                   | 0        |
| src/app/account/page.tsx                                             | 未審查                   | 0        |
| src/app/account/orders/page.tsx                                      | 未審查                   | 0        |
| src/app/account/orders/[id]/page.tsx                                 | 2026-07-03               | 1        |
| src/app/account/orders/[id]/support/page.tsx                         | 未審查                   | 0        |
| src/app/account/profile/actions.ts                                   | 未審查                   | 0        |
| src/app/account/profile/page.tsx                                     | 未審查                   | 0        |
| src/app/admin/orders/page.tsx                                        | 2026-07-03               | 1        |
| src/app/admin/orders/[id]/page.tsx                                   | 2026-07-03               | 1        |
| src/app/admin/orders/[id]/customer-info.tsx                          | 未審查                   | 0        |
| src/app/admin/orders/[id]/order-actions.tsx                          | 未審查                   | 0        |
| src/app/admin/orders/[id]/support-requests.tsx                       | 未審查                   | 0        |
| src/app/layout.tsx                                                   | 未審查                   | 0        |
| src/app/page.tsx                                                     | 未審查                   | 0        |
| src/app/ui/page.tsx                                                  | 未審查                   | 0        |
| src/proxy.ts                                                         | 2026-07-03               | 1        |
| src/lib/auth/require-user.ts                                         | 2026-07-03               | 1        |
| src/lib/auth/find-or-create-member.ts                                | 2026-07-03               | 1        |
| src/lib/cart/read-cart.ts                                            | 未審查                   | 0        |
| src/lib/cart/get-cart-count.ts                                       | 未審查                   | 0        |
| src/lib/checkout/schema.ts                                           | 未審查                   | 0        |
| src/lib/account/schema.ts                                            | 未審查                   | 0        |
| src/lib/order/state-machine.ts                                       | 未審查                   | 0        |
| src/lib/order/order-status.ts                                        | 未審查                   | 0        |
| src/lib/pii/audit.ts                                                 | 2026-07-03               | 1        |
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
