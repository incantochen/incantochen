# 開發審查發現（review-findings.md）

> 本檔是 dev-review skill 的工作底稿與唯一累積點：無人值守執行時自動寫入，不動 tasks.csv、不開 issues。
> **只有使用者能把狀態改成「確認」或「不採納」**；經確認的項目才由後續 session 轉入 tasks.csv＋GitHub issues。
> F 編號永久遞增不重用。

## 審查記錄

| 日期       | 範圍                                       | 模型            | 新發現       | 備註                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------ | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-02 | code＋schema＋flow（跳過 env，無雲端憑證） | claude-opus-4-8 | F-001～F-004 | 首份 review-findings.md；對抗性＋類別清單兩遍式。money chain 既有問題 T67–T83 逐一確認仍在列管（見末尾回歸狀態）。本次聚焦 T33 售後新程式與 T65 快照 delta。                                                                                                                                                 |
| 2026-07-03 | code＋schema＋flow（跳過 env，無雲端憑證） | claude-opus-4-8 | F-005～F-006 | 排程審查。本輪依覆蓋表輪替補審**上輪未讀的金流鏈三支＋checkout success/failed/pay＋login/auth/proxy＋admin/account 存取控制**共 19 檔。程式自上輪（commit 2503267）起未變動，T67–T83 全數維持原狀。新發現 F-005（T73 根因未涵蓋 pay/failed 頁）、F-006（登入 redirect 開放轉址）皆為上輪未讀檔案暴露之缺口。 |
| 2026-07-07 | code（使用者要求全面風險 Review，僅分析不落地 tasks/issues） | claude-fable-5 | F-008～F-013 | 本輪主軸為 **PR #31（T37 Sentry）／PR #32（T30b 出貨通知信）／PR #33（T89 主動對帳）合併後的 delta**。逐行複核 T89 對帳鏈三支（cron route／query-trade-info／ensure-paid）：**品質良好**——CAS 守衛、`{error}` 檢查、金額核對、限流退避、冷卻機制皆到位，無 P0/P1 發現。T30b 出貨通知信驗證正確（escapeHtml、sendOnce 去重、PGRST116 分辨）。覆蓋表輪替補審 20+ 支從未審過的檔案（checkout 鏈前端＋購物車讀取＋auth confirm＋account＋supabase client 三支＋next.config＋pii/mask 等）。新發現 F-008～F-013 全數 P2 以下。**注意：T89 程式已 merge（PR #33）但 tasks.csv 仍標「未開始」，待結案回寫。** |
| 2026-07-04 | code＋schema＋flow（跳過 env，無雲端憑證） | claude-opus-4-8 | F-007        | 排程審查。本輪主軸為 **PR #30（T67／T68／T69）與 PR #29（T85）合併後的金流鏈 delta**——上輪宣稱 `src/` 自 2503267 未變動已不成立。逐行複核 T67／T68／T69 三項修法：**皆驗證正確**（order-result `slice(11,17)` 與 notify fallback 一致；notify 外層 catch 回 `0                                               | Internal Error`＋兩路徑 `TradeAmt`金額核對＋Supabase`{error}`檢查；send-once.ts 落實 notification unique 去重）。新程式`send-once.ts` 的 never-throw 缺口＝既有 T88，不重報。覆蓋表輪替補審 5 支從未審查檔（`state-machine.ts`／`order-status.ts`／`env.server.ts`／`rate-limit.ts`＋`send-once.ts`），於 `state-machine.ts` 發現 **F-007（狀態機 UPDATE 缺前置狀態守衛，check-then-act 併發競態）**。 |

---

## F-001 [P1] 售後通知 Email 未跳脫客人自由輸入的「說明」→ 店家信箱 HTML／釣魚注入

- 狀態：已轉任務(T84)（使用者 2026-07-03 確認）
- 位置：`src/lib/email/support-request-notification.ts:71`（`${request.description}`）；同檔 `:63` recipient_name 亦未跳脫
- 失敗情境：任何登入會員在 `/account/orders/[id]/support` 的「說明」欄（自由文字，Zod／DB 上限 2000 字，內容完全由客人控制）填入 `</td></tr></table><a href="https://evil.example">請點此領取退款</a>` 之類的 HTML，送出後 `sendSupportRequestNotification` 直接把該字串以樣板字串插進信件 HTML（無跳脫），寄到店家信箱 `fishead02290@gmail.com`。店家收到的信會渲染攻擊者植入的任意 HTML／釣魚連結／偽造版面，可被用於社交工程（誘導店家點惡意連結或誤把退款匯到他處）。`description` 是全站最「純攻擊者可控」的欄位——它就是一個給客人自由打字的大文字框。全專案 grep 無任何 `escapeHtml`／`sanitize` 函式（三支寄信程式都靠樣板字串直插）。
- 修法：新增共用 `escapeHtml()`（替換 `& < > " '`），套用到本檔所有插值（`description`、`recipient_name`、`order_no`、`typeLabel`、`customerEmail`）。**與 T72 同一根本原因**（Email 模板 HTML 注入），但 T72 只點名 `order-confirmation.ts`／`new-order-notification.ts` 兩支，**未涵蓋 T33 後新增的第三支 `support-request-notification.ts`**——修 T72 時務必把共用 escape 一併套到本檔，否則注入仍在。建議與 T72 合併為同一批修復並互相註記。
- 記錄：2026-07-02 首次發現（本檔第一輪）。T33（2026-07-02 完成）新增本寄信程式，晚於產生 T72 的那次審查，故未被 T72 涵蓋。

## F-002 [P2] 售後申請無限流、無去重：登入客人可灌爆店家信箱與 support_request 表

- 狀態：已轉任務(T93)（使用者 2026-07-08 確認）
- 位置：`src/app/account/orders/[id]/support/actions.ts:16`（`createSupportRequest`，無 rate limit、無「同單已申請」去重）
- 失敗情境：擁有一張 paid 訂單的登入會員，反覆呼叫 `createSupportRequest`（UI 重複點擊或直接 script server action）→ 每次都通過擁有權檢查、insert 一列 `support_request` 並 `await sendSupportRequestNotification` 寄一封信給店家。結果：店家信箱被同一張訂單的售後信洗版、`support_request` 表無上限膨脹。相較 T78（匿名可無限建 cart）本路徑需登入＋擁有真實 paid 訂單，濫用門檻較高，故列 P2。
- 修法：對 `createSupportRequest` 加速率限制（`src/lib/rate-limit.ts` 已有 Upstash 基礎設施，可用 memberId＋orderId 當 key）；或加「同訂單 pending 期間僅允許一筆」的去重（查現有 open 案件即拒新增，引導客人回覆既有信件）。與 T78 同屬「高成本／可灌爆寫入路徑缺限流」（code-checklist G3）。
- 記錄：2026-07-02 首次發現。

## F-003 [P2] 相依套件 postcss 8.4.31 有 moderate XSS 公告（CVE-2026-41305）

- 狀態：已轉任務(T94)（使用者 2026-07-08 確認）
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

## F-007 [P2] 訂單狀態機 UPDATE 缺前置狀態守衛：後台併發（雙擊／多管理者）改狀態→重複／矛盾 order_status_log、稽核鏈汙染

- 狀態：已轉任務(T92)（升級為 P1，因觸及 order_status_log 財務稽核鏈完整性）
- 位置：`src/lib/order/state-machine.ts:43-46`（`transitionOrder` 的 `UPDATE orders SET status=to WHERE id=orderId`，**無 `.eq("status", from)`**）；同檔 `:83-87`（`adminOverrideStatus` 同模式）。呼叫端：`src/app/admin/orders/[id]/actions.ts:20`（`changeStatus`）、`:36`（`shipOrder`）、`:51`（`overrideStatus`）。
- 失敗情境：`transitionOrder` 是典型 check-then-act：先 `select status`（記為 `from`）→ `canTransition(from,to)` 驗證 → `UPDATE ... WHERE id=orderId`（**只綁 id、不綁 from**）→ `INSERT order_status_log(from,to)`。UPDATE 與先前的 SELECT 之間沒有原子守衛，兩個並發請求會雙雙通過。具體兩情境：①**雙擊同一鈕**：後台一張 `paid` 訂單，管理者雙擊「製作中」→ 兩個 `changeStatus(id,"in_production")` 同時進來，都讀到 `from=paid`、都 `canTransition(paid→in_production)=true`、都 UPDATE、都 INSERT log → `order_status_log` 出現**兩列一模一樣的 paid→in_production**（稽核鏈憑空多一筆）。②**兩個合法但互斥的目標**：管理者近乎同時點「製作中」與「退款」（或兩位管理者各點一個）→ 兩者都讀到 `from=paid`，`canTransition(paid→in_production)` 與 `canTransition(paid→refunded)` **皆為 true**，兩個 UPDATE 後寫者勝（訂單最終可能是 `refunded`），但 log 同時留下 `paid→in_production` 與 `paid→refunded` 兩條矛盾記錄——一張**已退款訂單的稽核鏈顯示它同時又進了製作中**，帳務稽核（T46 明訂 order_status_log 為稽核紅線）自相矛盾且無法判讀真實流轉。對照組：同 commit 的 `notify/route.ts:47-53` `ensureOrderPaid` **正確**採用條件式 UPDATE（`.eq("status","pending_payment")`＋`.select().maybeSingle()` 判斷是否搶到），本檔卻沒跟上——同一 codebase 已有正解、狀態機這條路徑漏套，屬 code-checklist **B2（狀態機守衛缺失）**。
- 修法：`transitionOrder` 的 UPDATE 加 `.eq("status", from)` 前置守衛，並 `.select("id").maybeSingle()`；回傳為 null（0 列命中）代表在 SELECT 與 UPDATE 之間狀態已被他人改動 → throw「訂單狀態已變更，請重新整理後再試」，**不寫 log**（避免對未實際發生的轉換留稽核）。`adminOverrideStatus` 雖刻意繞過 `canTransition`，仍應加同一 `.eq("status", from)` 守衛以防「同一次 override 併發重複寫 log」（override 的語意是任意目標，但仍該一次只成功一筆）。屬品質／正確性改善（P2）；惟因觸及財務訂單稽核鏈完整性，靠近 P1 邊界，是否升級由使用者確認。
- 記錄：2026-07-04 首次發現（覆蓋表輪替首次逐行審 `state-machine.ts`；PR #30 delta 複核時對照 `ensureOrderPaid` 的條件式 UPDATE 正解而暴露此不對稱）。

## F-008 [P2] 客人端讀取路徑普遍未檢查 Supabase `{error}`：DB 暫時性故障被誤判為「查無資料」，付款中客人被誤導離開

- 狀態：已轉任務(T95)（使用者 2026-07-08 確認）
- 位置：`src/app/checkout/pay/page.tsx:21-27`（訂單查詢 error 未檢查→`!order` redirect `/checkout`）；`src/app/checkout/success/page.tsx:16-22`（同模式→redirect `/`）；`src/app/checkout/actions.ts:49-66`（cart／cart_item 查詢→「購物車已空」）；`src/lib/quote/verify-prices.ts:56-64`（product 查詢→「商品已下架或不存在」）；`src/lib/cart/read-cart.ts:23-39`、`src/lib/cart/get-cart-count.ts:11-23`、`src/app/products/[slug]/actions.ts:27-49`（同模式，顯示層）
- 失敗情境：Supabase 暫時性故障（statement timeout／連線池耗盡）時查詢回 `{ data: null, error }`，這些呼叫點只解構 `data`——與「查無資料」無法區分。最痛的兩點：①客人已建單、正要進 `/checkout/pay` 付款的瞬間 DB 抖動→被 redirect 回 `/checkout`，而購物車已在建單時清空（T75），客人看到空購物車、以為訂單消失；②客人**已付款**回到 `/checkout/success` 時 DB 抖動→被 redirect 回首頁，付款成功卻看不到任何確認，直接聯繫客服或重複下單。`verifyCartPrices` 則會回「商品已下架」的錯誤訊息擋單（方向安全但診斷錯誤）。全部屬 CLAUDE.md §6「SDK 錯誤回傳必檢查」缺陷類別（code-checklist F1）——T68 修了 webhook 側，客人端讀取路徑漏套同一 pattern。金額決策鏈（verifyCartPrices 重算、webhook 金額核對）不受影響，失敗方向都是 fail-closed，故列 P2 而非 P1。
- 修法：各呼叫點解構並檢查 `error`：頁面層改 render「系統忙碌中，請重新整理」（不可 redirect 走人）；action 層回傳「系統忙碌，請稍後再試」與「購物車已空」區分；`verifyCartPrices` 對 `error` throw「系統忙碌」而非「商品已下架」。與 T79（findOrCreateMember 吞錯）同根因不同位置，建議同批修復。
- 記錄：2026-07-07 首次發現（本輪首次逐行審 checkout 鏈客人端與購物車讀取路徑）。

## F-009 [P2] order_no↔MerchantTradeNo 重組邏輯仍散落兩處 inline 複本，違反 §6「格式互轉單一出處」規則（T67 根因未根治）

- 狀態：已轉任務(T96)（使用者 2026-07-08 確認）
- 位置：`src/app/api/ecpay/order-result/route.ts:14`＋`src/app/api/ecpay/notify/route.ts:54`（兩處各自手刻 `slice(0,3)/(3,11)/(11,17)` 重組）；正向轉換在 `src/lib/ecpay/merchant-trade-no.ts`（僅 generate、無 parse）
- 失敗情境：T67 的根本原因是「同一格式的解析點散落多處、失同步」（trade no 加 2 碼後綴時 `slice(11)` 沒跟上）。修復只把兩處都改對，**沒有收斂成單一實作**——CLAUDE.md §6 明文「識別碼格式互轉單一出處…只能有一份實作供 import，禁止各處手刻」。下次 order_no 格式演進（如後綴改 8 碼、加品類前綴）時，改了 `generateMerchantTradeNo` 與其中一處解析點、漏掉另一處，就是 T67 完整重演：付款成功的客人被導回首頁或 webhook fallback 查無訂單。
- 修法：在 `merchant-trade-no.ts` 新增 `merchantTradeNoToOrderNo(tradeNo: string): string`（含格式防呆），order-result 與 notify fallback 兩處改 import；既有 route 測試（T85）加一條 round-trip 測試（generate→parse 還原）鎖住兩端同步。純重構、行為不變，工作量 ≤0.25 天。
- 記錄：2026-07-07 首次發現（C1 類別掃描：逐一清點同格式解析點）。

## F-010 [P2] Production CSP `script-src 'unsafe-inline'`：XSS 縱深防禦形同未設防

- 狀態：已轉任務(T97)（使用者 2026-07-08 確認）
- 位置：`next.config.ts:8`（`isDev ? ... : "script-src 'self' 'unsafe-inline'"`）
- 失敗情境：production CSP 的 `script-src` 允許 `'unsafe-inline'`——任何一個 XSS 注入點（現在列管中的 T72/T84 Email 端不受 CSP 管，但未來任何頁面端未跳脫輸出、或第三方套件漏洞）注入的 `<script>` 內聯腳本都會直接執行，CSP 對 XSS 的攔截力為零，只剩 `form-action`／`frame-ancestors` 等其他指令仍有效。T58 當時為了 React/Next inline bootstrap 的相容性妥協，但這讓「CSP 已部署」成為 G1 類「設計了但防不到」的機制——對 XSS 這個主要威脅它是虛設的。
- 失敗機率低（需先存在另一個 XSS 缺陷才會兌現），屬縱深防禦強化，列 P2、上線前不阻擋。
- 修法：Next.js App Router 的正解是 nonce-based CSP——在 `src/proxy.ts` 每請求產 nonce、設 `Content-Security-Policy` header（`script-src 'self' 'nonce-…' 'strict-dynamic'`），Next 會自動把 nonce 帶進框架 script。注意這會使全站轉動態渲染（本專案本來就預設動態，影響小）；改完用 securityheaders.com 掃 staging 驗證。若 nonce 遷移成本過高，退而求其次記錄此為已知接受風險。
- 記錄：2026-07-07 首次發現（next.config.ts 首次逐行審查）。

## F-011 [P2] createOrder 無伺服器端防重複提交：跨分頁併發送出→同一購物車建出兩張待付款訂單

- 狀態：已轉任務(T98)（使用者 2026-07-08 確認）
- 位置：`src/app/checkout/actions.ts:29-218`（全程無冪等鎖；`checkout-form.tsx:194` 的 `disabled={isPending}` 只擋同一分頁）
- 失敗情境：客人開兩個分頁都停在 `/checkout`（或雙擊瞬間繞過 client disable 的邊緣時序），兩個 `createOrder` 併發進來：都在步驟②讀到同一 cart 與 cart_items（此時都還沒被刪）、各自通過驗價、各自 insert 一張 `pending_payment` 訂單（order_no 不同、不會撞 unique）、其中一個刪掉 cart。結果同一次購買意圖產生兩張有效待付款訂單，兩個分頁各自導向自己的 ECPay 付款頁——客人若困惑之下兩邊都完成付款，**真金白銀重複扣款**，只能靠人工發現後退刷。機率低（需要跨分頁近乎同時送出），故 P2。
- 修法：建單前對 cart 做原子性 claim（如 `UPDATE cart SET status='checking_out' WHERE id=? AND status='active'` 的 CAS，0 列命中即回「訂單處理中」），或併入 T76 的 RPC 交易化時以 cart id 上 advisory lock 一次解決。**建議與 T76 同批**（同檔重構、機制相同）；若 T75（付款後才清車）先做，本項的曝險窗口會拉長，耦合更緊。
- 記錄：2026-07-07 首次發現（B 類併發掃描套用到 createOrder 全流程）。

## F-012 [P2-low] 對帳 cron 的 CRON_SECRET 比對非 timing-safe

- 狀態：已轉任務(T99)（使用者 2026-07-08 確認）
- 位置：`src/app/api/cron/ecpay-reconcile/route.ts:52-55`（`authHeader !== \`Bearer ${serverEnv.CRON_SECRET}\``）
- 失敗情境：字串 `!==` 逐字元短路比對，理論上可被 timing attack 逐字元猜出 secret，猜到後可任意觸發對帳批次（打 ECPay 查詢 API 消耗額度、觸發告警噪音；對帳本身冪等、無法竄改金額，故傷害有限）。實務上 HTTPS 網路抖動遠大於字元比較時差、且 secret 為高熵長字串，可利用性極低——列入是因 code-checklist A4 明文「驗證用 timing-safe 比對」，而同 codebase 的 CheckMacValue 驗證已用 timing-safe（不對稱）。
- 修法：改 `crypto.timingSafeEqual`（先比長度、轉 Buffer），或沿用 `check-mac-value.ts` 既有 timing-safe 工具。一行修改。
- 記錄：2026-07-07 首次發現（T89 delta 逐行審查）。

## F-013 [P2-low] 根目錄 `types/supabase.ts` 為過時型別殘留：無人引用、與正式生成檔並存易誤 import

- 狀態：已轉任務(T100)（使用者 2026-07-08 確認）
- 位置：`types/supabase.ts`（根目錄，179 行，帶 BOM）；正式檔為 `src/types/database.types.ts`（813 行，14 表，隨 migration 再生成）
- 失敗情境：全 repo grep 無任何 import 引用它——是早期 `supabase gen types` 的殘留（僅含最初 schema，缺 0003–0007 的欄位與 support_request 表）。風險在未來：IDE auto-import 對 `Database` 型別給出兩個候選，選錯的話拿到舊 schema——編譯照過（欄位子集相容時）、執行期才發現 insert 缺欄位或型別不符；也污染「改 schema 後重新 gen types」的心智模型（跑了正式檔、殘留檔永遠是舊的）。
- 修法：確認無引用後直接刪除（一個 `git rm`）。
- 記錄：2026-07-07 首次發現（覆蓋母集 diff：此檔從未列入覆蓋表）。

---

## 既有列管任務回歸狀態（2026-07-02 確認仍在列管、未修）

本輪走讀 money chain 與購物車／auth／email，逐一確認下列既有審查任務（T67–T83／GitHub #9–#25）皆**尚未修復、仍有效**，依去重規則不重報：

> **2026-07-03 排程審查再確認**：`git log` 顯示自上輪審查（commit `2503267`）後 `src/` 全無變動（其後皆 docs／skills commit），故 T67–T83 逐條維持原狀、位置行號不變。本輪新讀金流鏈三支＋checkout success/failed/pay＋login/auth/proxy＋admin/account，新增 F-005（開放轉址）、F-006（T73 根因未涵蓋 pay/failed）。

> **2026-07-07 全面風險審查再確認**：自上輪後 `src/` 再變動——PR #31（T37 Sentry）／#32（T30b 出貨通知信）／#33（T89 主動對帳）合併。**T37／T30b／T89 實作皆複核正確**（Sentry 已接進 notify／send-once／reconcile 的既有靜默失敗點；出貨信有 escapeHtml＋sendOnce 去重；對帳 cron 的 CAS／金額核對／`{error}` 檢查／限流退避齊全）。既有列管逐條再確認：**T70／T71／T72＋T84／T73（三頁）／T74／T75／T76／T77／T78／T79／T81／T86／T87／T88／T92 全數仍在**（本輪均逐行重看對應程式碼）；T80／T82／T83 未動（env 範圍本輪未跑）。特別註記：①T72/T84 的修復成本已下降——共用 `escapeHtml()` 已隨 T30b 落地（`src/lib/email/escape-html.ts`），剩下把三支舊寄信程式的插值套上；②T88 **不因 T89 而緩解**——對帳只撈 `status='pending'` 的 payment，「webhook 成功但寄信失敗」的訂單 payment 已是 paid，對帳永遠不會碰到它，信件仍會永久卡在 failed；③T89 已 merge 但 tasks.csv 未結案回寫。

> **2026-07-04 排程審查再確認**：自上輪（`73ebfbe`）後 `src/` **已變動**——PR #30（T67／T68／T69）與 PR #29（T85）合併。**T67／T68／T69／T85 已修復並複核正確、移出待修清單**（見下方 ✅ 標記與本輪審查記錄）。其餘 T70／T71／T72／T73／T74／T75／T76–T81／T82／T83 對應程式本輪未變動（`checkout/actions.ts`、`cart/*`、三支寄信程式的 escape 缺口、`state-machine.ts` shipOrder 順序等），逐條**確認仍在**。T88（sendOnce never-throw 缺口）於本輪逐行審 `send-once.ts` 再確認屬實、仍待架構決策。新增 F-007（狀態機併發守衛缺失）。

- **T67（#9, P0）** ✅ **已修復（2026-07-04，PR #30）**：`order-result/route.ts` 改 `slice(11,17)`。
- **T68（#10, P0）** ✅ **已修復（2026-07-04，PR #30）**：外層 catch 改回 `0|Internal Error`；正常/fallback 兩路徑皆加 `TradeAmt` 金額核對。PR merge 前的三輪 `/code-review ultra` 追加發現並修復：`ensureOrderPaid`／`ensureNotificationSent`／payment UPDATE 皆補上 Supabase `{error}` 檢查（原本只看 `data`，暫時性 DB 錯誤會被誤判成功、訂單卡在 `pending_payment` 無法自癒）。
- **T69（#11, P0）** ✅ **已修復（2026-07-04，PR #30）**：email 寄送改 `await`；新增 `src/lib/notification/send-once.ts` 落實 `notification` 表 `unique(order_id,type)` 去重（claim/reclaim/stale-pending）。**已知殘留缺口**：`sendOnce` 的 never-throw 契約讓「寄信本身失敗」這個情境的自癒機制打不到（webhook 仍回 `1|OK`，ECPay 不會重送觸發重試）——登記為 **T88** 另外處理，屬架構決策不阻塞本次 merge。
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

- **待確認超過 14 天的發現**：無（門檻 14 天）。仍待確認者：無——F-002→T93、F-003→T94、F-008～F-013→T95～T100（使用者 2026-07-08 確認轉任務）。F-007 已轉 T92、F-005 已轉 T86、F-006 已併入 T73、F-004 已修（T85）——均不再計入待確認。
- **從未審查過的檔案（覆蓋表中審查次數＝0）**：本輪大幅補審 20+ 檔（checkout 鏈前端、cart 讀取、auth confirm、account actions、supabase client、next.config、pii/mask、admin order-actions 等）後，剩餘未審者主要為：`checkout/page.tsx`、`cart/page.tsx`、`products/[slug]/page.tsx`、`product-configurator.tsx`、`support-request-form.tsx`、`cart-item-row.tsx`、`profile-form.tsx`、`account-nav.tsx`、`site-header.tsx`／`site-footer.tsx`、`layout.tsx`／`page.tsx`／`ui/page.tsx`、account 頁面四支、admin `customer-info.tsx`／`support-requests.tsx`、`supabase/client.ts`、`utils.ts`、`button.tsx`、`login/page.tsx` 外的 auth 頁、`0001`／`0002`／`0003` migration、`seed.sql`、`instrumentation*.ts`／`global-error.tsx`（本輪僅掃過未逐行）。多為展示層與純 UI，風險較低；建議下一輪補 `product-configurator.tsx`（計價顯示邏輯）與 `0001_initial_schema.sql`（schema 範圍時）。

---

## 檔案覆蓋表

> 母集＝`git ls-files` 排除純資產。「審查次數」自本檔首建（2026-07-02）起計；先前 2026-07-02 產生 T67–T83 的審查未留覆蓋表，故未計入。本輪實際逐行讀過者標日期＋1，其餘暫記 0（＝正式輪替尚未覆蓋，非零風險）。

| 路徑                                                                 | 最後審查日期             | 審查次數 |
| -------------------------------------------------------------------- | ------------------------ | -------- |
| src/app/api/ecpay/notify/route.ts                                    | 2026-07-07               | 3        |
| src/app/api/cron/ecpay-reconcile/route.ts                            | 2026-07-07               | 1        |
| src/lib/ecpay/query-trade-info.ts                                    | 2026-07-07               | 1        |
| src/lib/order/ensure-paid.ts                                         | 2026-07-07               | 1        |
| src/lib/notification/send-once.ts                                    | 2026-07-07               | 2        |
| src/app/api/ecpay/order-result/route.ts                              | 2026-07-07               | 3        |
| src/app/checkout/actions.ts                                          | 2026-07-07               | 2        |
| src/app/checkout/pay/page.tsx                                        | 2026-07-07               | 4        |
| src/lib/quote/verify-prices.ts                                       | 2026-07-07               | 2        |
| src/lib/email/order-confirmation.ts                                  | 2026-07-04               | 2        |
| src/lib/email/new-order-notification.ts                              | 2026-07-04               | 2        |
| src/lib/email/support-request-notification.ts                        | 2026-07-04               | 2        |
| src/lib/email/order-shipped-notification.ts                          | 2026-07-07               | 1        |
| src/lib/email/escape-html.ts                                         | 2026-07-07               | 1        |
| src/app/account/orders/[id]/support/actions.ts                       | 2026-07-02               | 1        |
| src/lib/support/support-request.ts                                   | 2026-07-02               | 1        |
| src/lib/support/schema.ts                                            | 2026-07-02               | 1        |
| src/app/admin/orders/[id]/actions.ts                                 | 2026-07-07               | 4        |
| src/lib/auth/require-admin.ts                                        | 2026-07-07               | 3        |
| supabase/migrations/0004_add_actor_to_order_status_log.sql           | 2026-07-02               | 1        |
| supabase/migrations/0005_add_product_name_snapshot_to_order_item.sql | 2026-07-02               | 1        |
| supabase/migrations/0006_add_support_request.sql                     | 2026-07-02               | 1        |
| supabase/migrations/0007_add_payment_last_reconciled_at.sql          | 2026-07-07（僅 stat 掃過） | 0        |
| src/lib/ecpay/aio-payment.ts                                         | 2026-07-07               | 3        |
| src/lib/ecpay/check-mac-value.ts                                     | 2026-07-03               | 1        |
| src/lib/ecpay/merchant-trade-no.ts                                   | 2026-07-07               | 2        |
| src/app/checkout/success/page.tsx                                    | 2026-07-07               | 2        |
| src/app/checkout/success/order-status-check.tsx                      | 2026-07-07               | 1        |
| src/app/checkout/failed/page.tsx                                     | 2026-07-03               | 1        |
| src/app/checkout/page.tsx                                            | 未審查                   | 0        |
| src/app/cart/actions.ts                                              | 2026-07-07               | 2        |
| src/app/cart/page.tsx                                                | 未審查                   | 0        |
| src/app/products/[slug]/actions.ts                                   | 2026-07-07               | 2        |
| src/app/products/[slug]/page.tsx                                     | 未審查                   | 0        |
| src/app/login/actions.ts                                             | 2026-07-03               | 1        |
| src/app/login/page.tsx                                               | 2026-07-03               | 1        |
| src/app/auth/confirm/actions.ts                                      | 2026-07-07               | 1        |
| src/app/auth/confirm/page.tsx                                        | 2026-07-07               | 1        |
| src/app/account/actions.ts                                           | 2026-07-07               | 1        |
| src/app/account/layout.tsx                                           | 未審查                   | 0        |
| src/app/account/page.tsx                                             | 未審查                   | 0        |
| src/app/account/orders/page.tsx                                      | 未審查                   | 0        |
| src/app/account/orders/[id]/page.tsx                                 | 2026-07-03               | 1        |
| src/app/account/orders/[id]/support/page.tsx                         | 未審查                   | 0        |
| src/app/account/profile/actions.ts                                   | 2026-07-07               | 1        |
| src/app/account/profile/page.tsx                                     | 未審查                   | 0        |
| src/app/admin/orders/page.tsx                                        | 2026-07-03               | 1        |
| src/app/admin/orders/[id]/page.tsx                                   | 2026-07-03               | 1        |
| src/app/admin/orders/[id]/customer-info.tsx                          | 未審查                   | 0        |
| src/app/admin/orders/[id]/order-actions.tsx                          | 2026-07-07               | 1        |
| src/app/admin/orders/[id]/support-requests.tsx                       | 未審查                   | 0        |
| src/app/layout.tsx                                                   | 未審查                   | 0        |
| src/app/page.tsx                                                     | 未審查                   | 0        |
| src/app/ui/page.tsx                                                  | 未審查                   | 0        |
| src/app/global-error.tsx                                             | 未審查                   | 0        |
| src/instrumentation.ts                                               | 未審查                   | 0        |
| src/instrumentation-client.ts                                        | 未審查                   | 0        |
| src/proxy.ts                                                         | 2026-07-03               | 1        |
| src/lib/auth/require-user.ts                                         | 2026-07-03               | 1        |
| src/lib/auth/find-or-create-member.ts                                | 2026-07-07               | 2        |
| src/lib/cart/read-cart.ts                                            | 2026-07-07               | 1        |
| src/lib/cart/get-cart-count.ts                                       | 2026-07-07               | 1        |
| src/lib/checkout/schema.ts                                           | 2026-07-07               | 1        |
| src/lib/account/schema.ts                                            | 2026-07-07               | 1        |
| src/lib/order/state-machine.ts                                       | 2026-07-07               | 2        |
| src/lib/order/order-status.ts                                        | 2026-07-04               | 1        |
| src/lib/pii/audit.ts                                                 | 2026-07-03               | 1        |
| src/lib/pii/mask.ts                                                  | 2026-07-07               | 1        |
| src/lib/rate-limit.ts                                                | 2026-07-04               | 1        |
| src/lib/env.server.ts                                                | 2026-07-07               | 2        |
| src/lib/env.ts                                                       | 2026-07-07               | 1        |
| src/lib/supabase/client.ts                                           | 未審查                   | 0        |
| src/lib/supabase/server.ts                                           | 2026-07-07               | 1        |
| src/lib/supabase/service-role.ts                                     | 2026-07-07               | 1        |
| src/lib/utils.ts                                                     | 未審查                   | 0        |
| src/components/checkout-form.tsx                                     | 2026-07-07               | 1        |
| src/components/product-configurator.tsx                              | 未審查                   | 0        |
| src/components/support-request-form.tsx                              | 未審查                   | 0        |
| src/components/cart-item-row.tsx                                     | 未審查                   | 0        |
| src/components/profile-form.tsx                                      | 未審查                   | 0        |
| src/components/account-nav.tsx                                       | 未審查                   | 0        |
| src/components/ecpay-auto-submit.tsx                                 | 2026-07-07               | 1        |
| src/components/site-header.tsx                                       | 未審查                   | 0        |
| src/components/site-footer.tsx                                       | 未審查                   | 0        |
| src/components/ui/button.tsx                                         | 未審查                   | 0        |
| src/types/database.types.ts                                          | 未審查（生成檔）         | 0        |
| types/supabase.ts                                                    | 2026-07-07（發現為殘留檔→F-013） | 1 |
| supabase/migrations/0001_initial_schema.sql                          | 未審查（本輪僅間接對照） | 0        |
| supabase/migrations/0002_enable_rls_and_policies.sql                 | 未審查（本輪僅間接對照） | 0        |
| supabase/migrations/0003_add_zip_code_to_orders.sql                  | 未審查                   | 0        |
| supabase/seed.sql                                                    | 未審查                   | 0        |
| next.config.ts                                                       | 2026-07-07               | 1        |
| vercel.json                                                          | 2026-07-07               | 1        |

> 註（2026-07-07）：本輪聚焦 PR #31／#32／#33 delta（Sentry／出貨通知信／T89 對帳鏈）＋大規模輪替補審 20+ 支未審檔（checkout 鏈前端、cart 讀取、auth confirm、account actions、supabase server/service-role、env 兩支、next.config、vercel.json、pii/mask、admin order-actions、checkout-form 等）。測試檔（`__tests__`／`*.test.ts`）不計入覆蓋表。已移除歷史誤植列 `src/app/api/ecpay/aio-payment（見 …）`。下一輪優先補審：`product-configurator.tsx`／`checkout/page.tsx`／`cart/page.tsx`／`supabase/client.ts`／`0001_initial_schema.sql`（schema 範圍時）。
