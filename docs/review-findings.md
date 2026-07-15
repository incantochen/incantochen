# 開發審查發現（review-findings.md）

> 本檔是 dev-review skill 的工作底稿與唯一累積點：無人值守執行時自動寫入，不動 tasks.csv、不開 issues。
> **只有使用者能把狀態改成「確認」或「不採納」**；經確認的項目才由後續 session 轉入 tasks.csv＋GitHub issues。
> F 編號永久遞增不重用。

## 審查記錄

| 日期       | 範圍                                                             | 模型            | 新發現                                                                          | 備註                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-02 | code＋schema＋flow（跳過 env，無雲端憑證）                       | claude-opus-4-8 | F-001～F-004                                                                    | 首份 review-findings.md；對抗性＋類別清單兩遍式。money chain 既有問題 T67–T83 逐一確認仍在列管（見末尾回歸狀態）。本次聚焦 T33 售後新程式與 T65 快照 delta。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-07-03 | code＋schema＋flow（跳過 env，無雲端憑證）                       | claude-opus-4-8 | F-005～F-006                                                                    | 排程審查。本輪依覆蓋表輪替補審**上輪未讀的金流鏈三支＋checkout success/failed/pay＋login/auth/proxy＋admin/account 存取控制**共 19 檔。程式自上輪（commit 2503267）起未變動，T67–T83 全數維持原狀。新發現 F-005（T73 根因未涵蓋 pay/failed 頁）、F-006（登入 redirect 開放轉址）皆為上輪未讀檔案暴露之缺口。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-07-07 | code（使用者要求全面風險 Review，僅分析不落地 tasks/issues）     | claude-fable-5  | F-008～F-013                                                                    | 本輪主軸為 **PR #31（T37 Sentry）／PR #32（T30b 出貨通知信）／PR #33（T89 主動對帳）合併後的 delta**。逐行複核 T89 對帳鏈三支（cron route／query-trade-info／ensure-paid）：**品質良好**——CAS 守衛、`{error}` 檢查、金額核對、限流退避、冷卻機制皆到位，無 P0/P1 發現。T30b 出貨通知信驗證正確（escapeHtml、sendOnce 去重、PGRST116 分辨）。覆蓋表輪替補審 20+ 支從未審過的檔案（checkout 鏈前端＋購物車讀取＋auth confirm＋account＋supabase client 三支＋next.config＋pii/mask 等）。新發現 F-008～F-013 全數 P2 以下。**注意：T89 程式已 merge（PR #33）但 tasks.csv 仍標「未開始」，待結案回寫。**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-07-07 | code＋schema＋flow（跳過 env；平行排程 session，remote bc6c2e6） | claude-opus-4-8 | F-014～F-016（原編 F-008～F-010，2026-07-08 合併時改編，見 F-016 下方編號說明） | 排程審查，與上列同日平行執行。同樣聚焦 T89／T30b／T37 delta。新發現 F-014（**P1**：reconcile 先翻 payment.status 再推進 order／通知，中途失敗後候選鍵失效→訂單永久卡 pending_payment，安全網自身留盲點——修正上列「對帳鏈無 P0/P1」的結論）、F-015（面交前綴寫入端與解析端各自手刻字面量）、F-016（read-cart 吞 error，已併入 T95）。另補審 checkout/page、product-configurator、instrumentation 三支、global-error、0007 migration。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-07-08 | code＋schema＋flow（跳過 env，無雲端憑證）                       | claude-opus-4-8 | F-017                                                                           | 排程審查。`src/` 自上輪（PR #33，commit d2aea85）起**全無變動**（其後皆 docs commit），T67–T108 全數維持原狀、依去重不重報。本輪價值在**覆蓋輪替**：首次逐行審 schema `0001`／`0002`／`0003`＋`seed.sql`（皆遵循 enum／RESTRICT／RLS deny-by-default／updated_at trigger／FK 索引慣例，`raw_callback`／`gateway_trade_no`／`uq_payment_one_paid_per_order`／`last_reconciled_at` 皆找到程式使用點——無 S7/G1 機制虛設）＋補審 20+ 支從未審過的展示層／account／admin UI 檔。新發現 F-017（P2：F-008／T95 的 `{error}` 忽略根因延伸到 T95「7 處」未列舉的會員 account 讀取頁與 PDP）。附帶確認：`/collections/[category]` 路由不存在（全站主導覽與麵包屑均連向它→404）＝T14（P0 未開始）之症狀；`/`（`src/app/page.tsx`）仍為 create-next-app 骨架＝T105（P1 未開始）之症狀，皆已列管不重報。`pnpm audit` 僅 postcss 一筆＝T94。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-07-09 | code＋schema＋flow（跳過 env，無雲端憑證）                       | claude-opus-4-8 | F-020                                                                           | 排程審查。本輪主軸為自上輪（2026-07-08）後合併的三支 PR delta：**PR #45（T70 cart.guest_token unique）／PR #48（T80 pii_access_log 落表）／PR #49（T86 登入開放轉址修正）**。**T80／T86 複核皆正確**——T80：`logPiiAccess` 改 async／失敗即 throw、`revealOrderPii` 已 await 且 fail closed（稽核寫不進去不回傳 PII），migration `0009` 遵循 RLS deny-by-default／revoke update+delete／FK RESTRICT／FK 索引／append-only 無 updated_at；T86：新增 `safe-redirect.ts` 拒 `//`／`/\`／tab/CR/LF 變形，`login/page.tsx` 已改用，附測試——**F-005 改標已修復**。新發現 **F-020（P2：addToCart 採 insert-first，與 coding-system §3.2 明列 addToCart 應 read-first 的 T70 教訓相反，回頭客每次加車先觸發註定失敗的 INSERT）**。另補審 3 支從未審過的純 UI 檔（`layout.tsx`／`ui/page.tsx`／`ui/button.tsx`，皆無業務邏輯無發現）＋ migration `0008`。F-018／F-019（T70 PR review 追加，2026-07-09）維持待確認。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-07-10 | code＋schema＋flow（跳過 env，無雲端憑證）                       | claude-opus-4-8 | F-021～F-022（＋F-017 追加 location）                                           | 排程審查。本輪主軸為自上輪（2026-07-09）後合併的 **PR #46（T78 購物車寫入限流＋guest cart 過期清理）** delta（`src/` 唯一變動來源）。**T78 複核大致正確**——`cartWriteIpRatelimit`／`cartWriteTokenRatelimit` 套進 addToCart／updateCartItemQuantity／removeCartItem 關閉 T78/G3 濫用面；新 `/api/cron/cart-cleanup`（90 天訪客車清理，CASCADE 帶 cart_item）給訪客車生命週期出口（C2），且正確採「先 SELECT 候選 id 再 DELETE」規避 PostgREST 42703（`.delete().order().limit()` 失敗）並檢查 `{error}`；`touchCartUpdatedAt` 補 cart_item 寫入不連動父層 updated_at 的缺口（失敗只 Sentry 不上拋，有註記）。**附帶確認一個 T78 隨手修好的既有潛伏 bug**：`otpIpRatelimit`／`otpVerifyIpRatelimit`／`otpEmailRatelimit` 原本皆未給 `prefix`，前二者同以 IP 為 identifier 會共用預設 key（`@upstash/ratelimit`）互相汙染計數（OTP 請求與 OTP 驗證共用 bucket）——本輪 5 個 instance 全數加上專屬 prefix，已修復、複核正確。新發現 F-021（cart-cleanup CRON_SECRET 非 timing-safe，與 F-012/T99 同根因、第二支 cron route）／F-022（cleanup DELETE 只綁 id、丟失 member_id/updated_at 守衛→TOCTOU），皆 P2-low；另 F-017 追加一個未列舉 location（`support/actions.ts` 訂單擁有權 SELECT 忽略 `{error}`）。`pnpm audit` 仍僅 postcss 一筆＝T94。                                                                                                                                                           |
| 2026-07-13 | code＋schema＋flow（跳過 env，無雲端憑證）                       | claude-opus-4-8 | F-023                                                                           | 排程審查。自上輪（2026-07-10）後 `src/`／`supabase/` 大幅變動——合併 **PR #53（T92）／#54（T72＋T84）／#55（F-011/T98）／#57（T111 後台代客建單）／#56（T09 後台框架）／#58（T40 RWD）／#60（T11 圖片上傳）／#59（T10 商品 CRUD）**，另 migration 0010–0013 首次入審。逐行複核最高風險新程式：**T111 代客建單鏈**（`admin/orders/checkout/actions.ts`＋抽出的共用 `create-order-from-cart.ts`）／**T10 商品 CRUD**（`admin/products/actions.ts`，updated_at 樂觀鎖 CAS＋slug 衝突＋品類切換守衛）／**T11 圖片上傳**（magic-byte 內容檢查、UUID 命名防遍歷、孤兒檔回滾、`insert_product_image`／`move_product_image` RPC 原子取號與交換）／**migration 0010–0013**（`create_order_with_items` SECURITY INVOKER＋revoke execute＋釘 search_path、`uq_orders_one_pending_per_cart`、`uq_product_image_product_sort`），**品質皆良好、無 P0/P1**。全數新 admin server action 皆 `requireAdmin()` 把關（D3 齊全）；三支 cron 已收斂到共用 `require-cron-auth.ts`（F-021「抽 helper」建議部分落地，惟 timing-safe 仍未做，見 F-021／T99）。新發現 **F-023（P2：T111 付款連結把 order_no 定性為刻意散佈的持有型憑證，與 T73 計畫中『pay 頁綁 session／guest 擁有權』的修法直接衝突，並抬高弱亂數 order_no 的枚舉風險）**——屬 T73↔T111 行為連鎖耦合。既有 T73／T77／T79／T81／T88／T96／T99／T108／T110＋F-017／F-018／F-019／F-020／F-021／F-022 逐條再確認仍在（見回歸狀態）。`pnpm audit` 仍僅 postcss＝T94。 |
| 2026-07-04 | code＋schema＋flow（跳過 env，無雲端憑證）                       | claude-opus-4-8 | F-007                                                                           | 排程審查。本輪主軸為 **PR #30（T67／T68／T69）與 PR #29（T85）合併後的金流鏈 delta**——上輪宣稱 `src/` 自 2503267 未變動已不成立。逐行複核 T67／T68／T69 三項修法：**皆驗證正確**（order-result `slice(11,17)` 與 notify fallback 一致；notify 外層 catch 回 `0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Internal Error`＋兩路徑 `TradeAmt`金額核對＋Supabase`{error}`檢查；send-once.ts 落實 notification unique 去重）。新程式`send-once.ts` 的 never-throw 缺口＝既有 T88，不重報。覆蓋表輪替補審 5 支從未審查檔（`state-machine.ts`／`order-status.ts`／`env.server.ts`／`rate-limit.ts`＋`send-once.ts`），於 `state-machine.ts` 發現 **F-007（狀態機 UPDATE 缺前置狀態守衛，check-then-act 併發競態）**。 |

---

## F-001 [P1] 售後通知 Email 未跳脫客人自由輸入的「說明」→ 店家信箱 HTML／釣魚注入

- 狀態：✅ 已修復（2026-07-12，T72／T84／PR #54）：三支寄信程式（`order-confirmation.ts`／`new-order-notification.ts`／`support-request-notification.ts`）全數改用共用 `escapeHtml()`；checkoutFormSchema 補上長度上限。三輪本機 code-review（ultra 額度用盡改本機 max effort fallback）另修正 checkout maxLength UX、補齊回歸測試、email 欄位長度上限。
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

- 狀態：已修復（PR #69，2026-07-15；T94 完成）——pnpm-workspace.yaml overrides 釘 `postcss@<8.5.10: '>=8.5.10 <9'`，audit 清零、build 無回歸
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

- 狀態：已修復（PR #49，2026-07-09；T86 完成，本輪複核正確）
- 位置：`src/app/login/page.tsx:10`（`const redirectTo = searchParams.get("redirect") ?? "/"`）＋ `:35`（`router.push(redirectTo)`）
- 失敗情境：攻擊者對受害者發出釣魚連結 `https://<本站>/login?redirect=https://evil.example/phish`（或協定相對 `//evil.example`）。受害者看到的是**本站真實網域**的登入頁、輸入真實 OTP 完成登入，`handleVerify` 成功後直接 `router.push(redirectTo)` 把受害者導向 `https://evil.example/phish`。`redirectTo` 完全取自 URL query，無「必須是站內相對路徑」的驗證——`router.push` 收到絕對 URL／協定相對 URL 會導到外站。攻擊者藉此把「剛在正牌站完成登入」的信任接力到偽造頁（要求補資料、付款、或竊取後續 referrer），是典型登入流程釣魚放大器。注意 `require-user.ts:11` 產生的 `redirect` 參數本身取自 proxy 覆寫的 `x-pathname`（站內路徑、安全），但**登入頁不該假設該參數只會由自家產生**——任何人都能手打任意 `?redirect=`。
- 修法：在 `login/page.tsx` 對 `redirectTo` 做站內白名單：僅接受以單一 `/` 開頭且非 `//`（亦擋 `/\`）的相對路徑，否則退回 `"/"`。例：`const raw = searchParams.get("redirect"); const redirectTo = raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/"`。屬新缺陷類別「開放轉址」，建議審後補進 code-checklist（D 類信任邊界）。
- 記錄：2026-07-03 首次發現（本輪首次審 login/page.tsx、require-user.ts、proxy.ts 之 redirect 鏈）。2026-07-09 複核 PR #49 修法：新增 `src/lib/auth/safe-redirect.ts`（僅接受單一 `/` 開頭、拒 `//`／`/\`／含 tab/CR/LF 之變形，否則退回 `/`），`login/page.tsx:11` 改用 `safeRedirect(searchParams.get("redirect"))`；附 `safe-redirect.test.ts` 涵蓋 `//evil.com`／`/\evil.com`／`/\t/evil.com` 等繞過向量——**修法正確，狀態改已修復**。

## F-006 [P2] T73 存取控制根因未涵蓋 `checkout/pay`、`checkout/failed` 兩頁（憑 order_no 讀單＋建 payment row）

- 狀態：已修復（PR #64，2026-07-14）——擁有權綁定已套用 success/pay/failed 三頁，pay 頁對非本人訂單擋在建 payment 之前；order_no 改 crypto.randomInt。隨 T73 結案。
- 位置：`src/app/checkout/pay/page.tsx:21-25`（憑 `order_no` service-role 讀單，無 session／擁有權綁定）＋ `:66-72`（為該單 insert 一列 pending `payment`）；`src/app/checkout/failed/page.tsx:15-19`（憑 `order_no` 讀 `order_no`/`status`）
- 失敗情境：T73 已列管「成功頁憑 order_no 揭露個資＋order_no 用 `Math.random` 可猜」，但其任務描述僅點名「**成功頁**綁 session／短效 cookie」。同一根因在 pay／failed 兩頁**未被涵蓋**：①`checkout/pay` 對任一可猜到的 `order_no` 直接以 service role 讀單，並把 `ItemName`（商品名＋數量）、`TotalAmount` 寫進可見的隱藏表單欄位（訂單明細外洩），且**會為別人的訂單 insert 一列 pending `payment`**（可被灌垃圾 payment row、或由第三方替他人發起付款）；②`checkout/failed` 憑 order_no 揭露 order_no＋status。三頁共用同一 order_no 即權限的缺口，若 T73 修法只補成功頁，pay／failed 仍開放——與 F-001／T72（修 escape 漏掉第三支寄信程式）完全同型的「同根因多點、修法只覆蓋一點」問題。
- 修法：把 T73 的存取控制修法（成功頁綁 session／短效 cookie／guest_token 或 member 歸屬）**一併套用到 `checkout/pay` 與 `checkout/failed`**，並在 pay 頁對「非本人訂單」拒絕讀取與 payment 建立。建議與 T73 同批修復並在 T73 任務／issue 註記「範圍含 pay／failed／success 三頁」。改 order_no 為 crypto 亂數（T73 已含）能降低猜測面，但**不可取代**擁有權綁定。
- 記錄：2026-07-03 首次發現（本輪首次逐行審 checkout/pay、success、failed 三頁）。

## F-007 [P2] 訂單狀態機 UPDATE 缺前置狀態守衛：後台併發（雙擊／多管理者）改狀態→重複／矛盾 order_status_log、稽核鏈汙染

- 狀態：✅ 已修復（2026-07-11，T92／PR #53）：`adminOverrideStatus` 補上 `.eq("status", from)` CAS 守衛＋`OrderTransitionRaceError`；`transitionOrder` 的守衛已於 T66（PR #51）先行修復。本機 code-review high 另抓到守衛在 `to===from` 時因 SET 未改動 WHERE 用到的欄位、對併發無效（CLAUDE.md §6 EvalPlanQual），改為 UPDATE 前直接擋下；本機 max effort 二輪另抓到 admin override 面板 `overrideTo` 的 useState 未隨 `currentStatus` 更新同步，已修復。審查過程發現的「CAS-update+log-insert 缺交易化」系統性風險已轉新任務 T110。
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

- 狀態：已修復（PR #55，2026-07-12；T98 完成）
- 位置：`src/app/checkout/actions.ts:29-218`（全程無冪等鎖；`checkout-form.tsx:194` 的 `disabled={isPending}` 只擋同一分頁）
- 失敗情境：客人開兩個分頁都停在 `/checkout`（或雙擊瞬間繞過 client disable 的邊緣時序），兩個 `createOrder` 併發進來：都在步驟②讀到同一 cart 與 cart_items（此時都還沒被刪）、各自通過驗價、各自 insert 一張 `pending_payment` 訂單（order_no 不同、不會撞 unique）、其中一個刪掉 cart。結果同一次購買意圖產生兩張有效待付款訂單，兩個分頁各自導向自己的 ECPay 付款頁——客人若困惑之下兩邊都完成付款，**真金白銀重複扣款**，只能靠人工發現後退刷。機率低（需要跨分頁近乎同時送出），故 P2。
- 修法：建單前對 cart 做原子性 claim（如 `UPDATE cart SET status='checking_out' WHERE id=? AND status='active'` 的 CAS，0 列命中即回「訂單處理中」），或併入 T76 的 RPC 交易化時以 cart id 上 advisory lock 一次解決。**建議與 T76 同批**（同檔重構、機制相同）；若 T75（付款後才清車）先做，本項的曝險窗口會拉長，耦合更緊。
- 記錄：2026-07-07 首次發現（B 類併發掃描套用到 createOrder 全流程）。2026-07-12 複核：核心防護已隨 T76（PR #51，migration 0011 `uq_orders_one_pending_per_cart` partial unique index）以更乾淨的形式落地——同一 cart 同時間僅允許一筆 `pending_payment` 訂單，DB 層擋下併發雙送出，`checkout/actions.ts` 靠 23505 constraint 名稱區分 order_no 撞號（換號重試）與併發搶輸（導去贏家付款頁）。PR #55 補齊該碰撞路徑原本缺失的測試覆蓋，並修正 `racedOrder` 重查查詢缺少的 `{error}` 檢查（§6）——**修法正確，狀態改已修復**。

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

## F-014 [P1] ECPay 主動對帳（T89）先翻 payment.status 再推進 order／通知：候選鍵失效造成「已付款訂單永久卡 pending_payment」的安全網盲點

- 狀態：已轉任務(T107)（使用者 2026-07-08 確認）
- 位置：`src/app/api/cron/ecpay-reconcile/route.ts:141-177`（CAS 先把 `payment.status` 翻成 `paid`，再呼叫 `ensureOrderPaid`／`ensureNotificationSent`）＋候選查詢 `:76-85`（`.eq("status","pending")`）
- 失敗情境：reconcile 的候選集**只以 `payment.status='pending'` 為鍵**（`0001` schema `payment_status` enum＝pending/paid/failed/refunded）。對一筆綠界實際已收款的卡住付款，流程是：①CAS `UPDATE payment SET status='paid' WHERE id=X AND status='pending'` 搶到（`payment` 此刻已是 paid）→ ②`ensureOrderPaid(order_id,"reconcile")` 推進 `orders.status`。若步驟②的 `orders` UPDATE 遇暫時性 DB 錯誤（statement timeout／連線池耗盡），`ensure-paid.ts:50` 會 `throw`；此 throw **在迴圈體內無 try/catch 包裹**（`:141-177` 僅 `queryTradeInfo` 有 try/catch，promotion 段沒有），直接冒泡到外層 catch（`:221`）→ 回 500、整批中止。結果：`payment.status='paid'` 但 `orders.status` 仍停在 `pending_payment`。**隔日 cron 再跑時，候選查詢 `.eq("status","pending")` 不會再選到這筆（payment 已 paid），系統中也無任何機制回頭比對 orders.status vs payment.status**——這張「客人已付款」的訂單永久卡在 `pending_payment`，且 `ensureNotificationSent` 從未執行（確認信也沒寄），無 webhook 可再觸發（綠界早已收到回應或不再重送）。這正是 T89 設計本意要消滅的 Invariant 破壞（「付款成功的訂單最終必為 paid」），卻發生在 T89 自身內部。同型的次要變體：若②成功但 `ensureNotificationSent`（`:72-91`）在讀 orders 時 throw，訂單雖已 paid、但確認信不會被 reconcile 重試（payment 已非候選）。根本原因：reconcile 以「payment 是否 pending」為重試鉤子，卻**先消滅這個鉤子（翻 paid）才做後續步驟**，任何後續失敗都落在重試覆蓋範圍之外——對照 webhook 同樣先翻 payment，但 webhook 有綠界重送＋`paidPayment` 冪等分支（`notify/route.ts:65-76`）兜底，reconcile 沒有等價的重試來源。屬 code-checklist **F2（部分失敗殘留）＋B2 邊界／G1（安全網機制自身留盲點）**；機率低（需暫時性 DB 錯誤落在 payment CAS 之後的窄窗），但後果為永久金流不一致、無自動復原、無針對該單的告警（外層只 `captureException` 泛型例外），故列 P1（金流正確性）。
- 修法（擇一，優先 A）：**A. 調整順序讓 payment 翻 paid 成為最後一步**——先 `ensureOrderPaid`＋`ensureNotificationSent`（皆冪等），全部成功後才 CAS `UPDATE payment SET status='paid'`；如此任一中途失敗都讓 `payment` 留在 `pending`，隔日 cron 會重新選到、自動重試（與 webhook 靠綠界重送同理）。**B.**（若不願改順序）把每筆 promotion 段包進 try/catch，失敗時**不**冒泡中止整批，並讓 reconcile 候選集**改以 orders 不變式為準**：加撈「`orders.status='pending_payment'` 但已存在 `payment.status='paid'`」的漂移單一併修正，使安全網真正守在 `orders.status`（它要保證的不變式）而非 `payment.status`。無論 A/B，promotion 段的例外都應 per-item 隔離，避免一筆失敗拖垮整批。
- 記錄：2026-07-07 首次發現（本輪首次逐行審 T89 `cron/ecpay-reconcile/route.ts`＋`ensure-paid.ts`；對照 webhook fallback 的 `paidPayment` 冪等分支而暴露 reconcile 缺等價重試來源）。

## F-015 [P2] 面交前綴 "面交" 格式在寫入端與解析端各自手刻字面量，違反 §6「識別碼格式互轉單一出處」

- 狀態：已轉任務(T108)（使用者 2026-07-08 確認）
- 位置：寫入端 `src/app/admin/orders/[id]/order-actions.tsx:68-71`（`` `面交${pickupNote ? ` ${pickupNote}` : ""}` `` 組出 `tracking_no`）；解析端 `src/lib/email/order-shipped-notification.ts:12`（`const PICKUP_PREFIX = "面交"`）＋`:23-26`（`startsWith(PICKUP_PREFIX)`／`slice(PICKUP_PREFIX.length)` 反解出面交備註）
- 失敗情境：出貨資料沒有獨立的「配送方式」欄位，面交與宅配**共用 `orders.tracking_no` 一個字串**，靠「是否以『面交』開頭」在寄信時反推是面交還是宅配。這個格式約定的「面交」字面量在兩支不同檔案各寫一份（client 寫入端、email 解析端），中間僅靠註解「與該處寫法必須保持一致」維繫，無共用常數／函式強制同步——正是 CLAUDE.md §6 明列的「識別碼格式互轉單一出處」紅線（T67 `slice(11)` bug 即散落複本失同步所致）與 code-checklist **C1**。具體失敗：日後任何人調整 client 端面交寫法（例如改成「面交：<日期>」加冒號、或改用詞「自取」），只要沒同步改 email 端的 `PICKUP_PREFIX`，解析立刻失準——最壞情況面交訂單被判成宅配，客人收到「您訂購的商品已交由物流出貨，請留意簽收」（明明是面交），且面交備註被當成「物流單號」以等寬字體顯示；反之改詞後面交單會走進宅配文案。屬靜默錯誤（無例外、無告警），只有客人收到矛盾通知才會發現。
- 修法：把面交前綴與「組裝／解析 tracking_no」的邏輯收斂到單一模組（如 `src/lib/order/shipping-tracking.ts`），匯出 `PICKUP_PREFIX` 常數＋`buildPickupTracking(note)`／`parseTracking(trackingNo)` 供 client 寫入端與 email 解析端共同 import，禁止任一端再手刻 "面交" 字面量。中長期更穩健的作法是為 `orders` 增列獨立的配送方式欄位（脫離字串前綴魔法），惟屬 schema 變更需 plan mode，可留待物流策略 T48 一併定案。
- 記錄：2026-07-07 首次發現（本輪首次審 T30b `order-shipped-notification.ts`＋首次逐行審 `order-actions.tsx`）。

## F-016 [P2] read-cart.ts 讀取購物車忽略 Supabase `{error}`：暫時性 DB 故障→購物車「顯示為空」擋住結帳

- 狀態：已併入T95（合併時去重：T95〔F-008〕已涵蓋 read-cart.ts 在內的 7 處讀取路徑 error 檢查，issue #36）
- 位置：`src/lib/cart/read-cart.ts:23-27`（`const { data: cart } = ...maybeSingle()`，未解構／檢查 `error`）＋`:33-37`（`cart_item` 查詢同樣只取 `data`）
- 失敗情境：`getCart()` 對 `cart`／`cart_item` 兩次查詢都只取 `data`、丟棄 `error`。當 DB 遇暫時性故障（statement timeout／連線池耗盡）時，Supabase **不 throw、回 `{data:null,error}`**（CLAUDE.md §6 明列的 SDK 錯誤回傳模式）——此處把「查詢失敗」誤判成「查無資料」而 `return null`。呼叫端 `checkout/page.tsx:9` 據此 `redirect("/cart")`、`/cart` 亦顯示空車：一個購物車其實有商品的客人，在 DB 尖峰負載的當下被告知「購物車是空的」而無法結帳（轉換流失）。此外 `:27` 的 `.maybeSingle()` 在 T70（guest_token 無 unique、check-then-insert 併發產生重複 cart）情境下遇多列會回 error，此處同樣被吞成 null——與 T70 描述的「購物車消失」為同一表象、但**本項根因是「讀取端忽略 error」這個獨立缺陷**（即使 T70 補了 unique 約束消除多列來源，暫時性 DB 錯誤仍會讓本路徑靜默回空）。屬 code-checklist **F1（靜默吞錯）**，與 T79（findOrCreateMember 吞錯）同類、不同檔。
- 修法：兩次查詢都解構 `error` 並檢查——`error` 非 null 時 `throw`（讓 checkout/cart 頁顯示「暫時無法載入購物車，請稍後再試」而非誤導為空車），與「查無資料（data 為 null 且 error 為 null）才回 null」明確區分。建議與 T70 同批處理（同屬 cart 讀取路徑的健壯性），但可獨立先修。
- 記錄：2026-07-07 首次發現（本輪覆蓋表輪替首次逐行審 `read-cart.ts`）。

> **編號說明（2026-07-08 合併）**：以上三項為 2026-07-07 平行排程審查 session（claude-opus-4-8，remote commit bc6c2e6）的發現，原編 F-008～F-010；因與本地同日審查已公開綁定任務的 F-008～F-013（T95–T100、issues #34–#41）碰撞，依「F 編號永久遞增不重用」原則於合併時改編 F-014～F-016。F-014 為 P1 金流發現（本地審查漏判——本地曾記「reconcile 品質良好無 P0/P1」，以此項為準修正該結論）；F-016 與 T95 同根因已併入。

## F-017 [P2] Supabase `{error}` 忽略根因延伸至會員 account 讀取頁與商品詳情頁（T95「7 處」列舉未涵蓋，同型「同根因多點、修法只覆蓋一部分」）

- 狀態：待確認
- 位置：`src/app/account/orders/[id]/page.tsx:29`（`.single()` 只取 `data`，`!order`→`notFound()`；同檔 `:38-57` 的 `Promise.all` 讀 order_item／order_status_log／support_request 亦忽略 error）；`src/app/account/orders/page.tsx:11`（`{ data: orders }`）；`src/app/account/orders/[id]/support/page.tsx:27`＋`:36`（order＋requests 查詢）；`src/app/account/page.tsx:11`（`{ count }`）；`src/app/account/profile/page.tsx:8`（`{ data: member }`）；`src/app/products/[slug]/page.tsx:27`（`.single()`，`!product`→`notFound()`）
- 失敗情境：這些會員自助頁與公開 PDP 的查詢一律只解構 `data`、丟棄 `error`——與 F-008/T95 完全同一根本原因（CLAUDE.md §6「SDK 錯誤回傳必檢查」／code-checklist F1），但 **T95 的任務描述明列「pay／success 頁、createOrder、verify-prices、cart 讀取共 7 處」，這幾頁不在其列舉內**。Supabase 暫時性故障（statement timeout／連線池耗盡）時查詢回 `{ data: null, error }`，這裡把「查詢失敗」誤判成「查無資料」。最痛的一點：①**會員在 `/account/orders/[id]` 檢視自己一張真實已付款訂單**的瞬間 DB 抖動→`.single()` 回 error→`!order`→`notFound()`→會員看到「找不到此訂單」404 頁，誤以為訂單憑空消失、轉而重複下單或找客服（自癒需重新整理但客人不會知道）。其餘變體：②`/account/orders` 列表頁抖動→顯示「目前沒有訂單，去逛逛…」（訂單全消失的錯覺）；③`/account` 首頁 count 抖動→`hasOrders=false`→隱藏「查看訂單」捷徑改顯示「無訂單」；④PDP `/products/[slug]` 抖動→`notFound()`→把「商品暫時查不到」誤呈成「商品不存在」，可搜尋引擎誤收 404；⑤`/account/profile` 抖動→姓名欄回空字串（危害最低）。全部方向 fail-safe（不外洩、不遺失、重新整理即復原），故列 P2；但與 F-006（T73 漏 pay/failed）、F-001（T72 漏第三支寄信程式）完全同型——**T95 若僅照「7 處」字面修，這幾頁會被靜默留下、下輪審查必重新撞見**。
- 修法：把 T95 的 `{error}` 檢查修法**一併套用到本清單各頁**——頁面層對 `error` 非 null 時 render「系統忙碌中，請重新整理」而**非** `notFound()`／空狀態（避免把暫時性故障呈現成「訂單／商品不存在」）；`Promise.all` 的三支子查詢同理逐一檢查。建議在 **T95 的任務範圍與 issue #36 直接補註「範圍含 account 讀取頁（orders 列表／訂單詳情／support／account 首頁 count／profile）與 PDP，共 6 檔」**，與現有 7 處同批一次收斂，避免二次施工。與 T79（findOrCreateMember 吞錯）同根因。
- 記錄：2026-07-08 首次發現（覆蓋輪替首次逐行審 account 頁面四支＋support/page＋products/[slug]/page；對照 T95 的「7 處」列舉發現這批會員自助讀取路徑未被涵蓋）。

> **追加（2026-07-09）**：T70／PR #45 本機 `/code-review high` review 發現 `src/app/products/[slug]/actions.ts:29-34`（`product` 查詢）與 `:40-49`（`product_option` 查詢）同樣只解構 `data`、未檢查 `error`，與本項同一根因（CLAUDE.md §6）。同函式內的 `cart` insert 已於 T70 補上 `error` 檢查，這兩處未動、屬 pre-existing。建議併入 T95／issue #36 範圍一併處理，避免第三輪審查再次撞見。

> **追加（2026-07-10）**：本輪覆蓋輪替補審 `src/app/account/orders/[id]/support/actions.ts`（`createSupportRequest`，最後審查 2026-07-02），發現 `:37-41` 的訂單擁有權 SELECT（`const { data: order } = await serviceRole.from("orders").select("id, member_id, status")…maybeSingle()`）同樣只解構 `data`、未檢查 `error`，與本項及 F-008／T95 同一根因（CLAUDE.md §6「SDK 錯誤回傳必檢查」）。失敗情境：登入會員對自己一張真實 paid 訂單送出售後申請的瞬間 DB 抖動（statement timeout／連線池耗盡）→查詢回 `{data:null,error}`→被判 `!order`→回「找不到訂單」，會員誤以為訂單消失、無法提交瑕疵回報（fail-closed、重新整理即復原，故仍 P2）。這是 mutation action 內的讀取，非 F-017 原列舉的「讀取頁」，但屬同一 T95 群集；建議在 **T95／issue #36 範圍補記本檔**，與 pay/success/createOrder/verify-prices/cart 讀取＋account 讀取頁＋PDP＋products/actions.ts 一次收斂。同檔其餘防護正確（`requireUser`＋`member_id===user.id` 擁有權重查＋`canRequestSupport` 狀態守衛＋插入 `{error}` 檢查皆到位；售後限流／去重缺口另見 F-002／T93）。

## F-018 [P2-low] T70 PR review：`23505` 錯誤碼字面量在 4 個檔案重複、`CREATE UNIQUE INDEX` 未用 `CONCURRENTLY`

- 狀態：待確認
- 位置：`src/app/products/[slug]/actions.ts:110`（新增的第 4 個字面量，另 3 處為 `src/lib/notification/send-once.ts:114`、`src/app/checkout/actions.ts:177`、`src/app/api/ecpay/notify/route.ts:112`）；`supabase/migrations/0008_cart_guest_token_unique.sql:6`
- 失敗情境：Postgres unique_violation 錯誤碼 `"23505"` 目前在四個獨立檔案各自手刻字面量比對，與 F-009／F-015「識別碼格式互轉單一出處」同型——若比對邏輯需調整（如需一併攔 exclusion violation、加 log），須四處同步修改，任一遺漏會讓該呼叫點的衝突處理悄悄失效。另外，`0008` 是本專案第一支對「已有資料的正式表」新增 index 的 migration（`0001` 的 index 皆建於初始空表），未加 `CONCURRENTLY`、建置期間對 `cart` 持 ACCESS EXCLUSIVE 鎖；目前資料量小風險可忽略，但尚未建立「何時該用 CONCURRENTLY」的慣例，日後若在更大的表重演相同寫法，可能造成部署窗口延遲尖峰。
- 修法：（1）抽一個共用常數（如 `PG_UNIQUE_VIOLATION = "23505"`）供四處 import；（2）之後對已有資料的正式表加 index，優先評估 `CREATE INDEX CONCURRENTLY`（需注意 Supabase migration 交易包裹限制，可能需拆成不在單一 transaction 內執行）。兩項皆非阻塞性，可併入下次同類任務或獨立小型清理任務處理。
- 記錄：2026-07-09（T70／PR #45 本機 `/code-review high` 8 角度審查發現，PR merge 前已與使用者確認暫不在該 PR 處理）。

## F-019 [P2-low] T70 的 unique 約束修法未涵蓋「首次訪客」雙擊情境：guest_token cookie 尚不存在時，併發請求各自產生不同 token

- 狀態：待確認
- 位置：`src/app/products/[slug]/actions.ts:92-99`（`guestToken` 於 cookie 不存在時以 `crypto.randomUUID()` 產生，此邏輯為 T70 修改前後皆相同、未變動）
- 失敗情境：T70 的 partial unique index 只保護「併發請求已共用同一 guest_token」的情境（如同一分頁雙擊、已有 cookie 的雙分頁）。對於**完全沒有 cookie 的首次訪客**近乎同時雙擊「加入購物車」或開兩個分頁操作，兩個 server action 各自讀到空 cookie、各自呼叫 `crypto.randomUUID()` 產生**不同**的 token，兩筆 insert 因 token 不同都不會撞到 unique 約束，於是仍會產生兩筆 cart（各自掛一個 cart_item），最終只有一個 `Set-Cookie` 存活在瀏覽器，另一筆 cart／商品對客人來說「憑空消失」——這正是 T70 標題所指「雙擊、雙分頁」情境的其中一個子情境，未被本次修法涵蓋。此為 T70 修改前既已存在的行為（非本次引入的退化），本次 review 才首次明確點出。
- 修法：尚待設計；可能方向包含在頁面首次載入時（如 `src/proxy.ts`）就預先簽發 guest_token cookie，讓「加入購物車」永遠不是第一個設定 cookie 的動作，消除競爭窗口。屬於架構層調整，不建議倉促帶入既有 PR，需要獨立評估。
- 記錄：2026-07-09（T70／PR #45 本機 `/code-review high` 8 角度審查發現，PR merge 前已與使用者確認暫不在該 PR 處理，列為獨立後續項目）。

## F-020 [P2] addToCart get-or-create 採 insert-first，與 T70 教訓（coding-system §3.2 明列 addToCart 應 read-first）相反：回頭客每次加車都先觸發一次註定失敗的 INSERT

- 狀態：待確認
- 位置：`src/app/products/[slug]/actions.ts:101-124`（無條件先 `INSERT cart(guest_token=X)` → 撞 `23505` → 落 `:113` 分支 reselect）；對照 `docs/coding-system.md §3.2`（2026-07-09 T70 教訓，明列「addToCart——回頭客重複加車是常態」屬 **read-first** 案例）；T70 tasks.csv 列已記 `addToCart 改 insert-then-23505-retry`。
- 失敗情境：回頭客（已有 `guest_token` cookie 且該 token 已有一筆 cart）呼叫 `addToCart`——**這是購物車最常見的操作**：不只是隔日再訪，更常見的是「同一次逛街連加第 2、3、N 件」，第 1 件建立 cart 後，後續每一件都走到此路徑。每次 `addToCart` 都會無條件執行 `:101` 的 `INSERT INTO cart(guest_token=X)`，因該 token 的 cart 已存在，**必定違反 `uq_cart_guest_token` 觸發 `23505`**，才落入 `:113` 重查取回既有 cart。淨結果：全站最高頻的購物車寫入操作，每次都付出 **2 次 DB round trip（一次註定失敗的 INSERT ＋一次 SELECT）而非 1 次 SELECT**，並在 Postgres 端每次寫一筆 `unique_violation` 到 log、留下一個失敗 INSERT 的 dead tuple。這正是 §3.2 驗收判準「hot path 是否避免了『可預期但沒有價值』的資料庫 round trip」所指的浪費——而 §3.2 自己就把 addToCart 明列為 read-first 案例（「回頭客重複加車是常態」）。合併的程式（PR #45，commit 早於 §3.2 教訓寫成）從未回頭對齊該教訓，形成「文件（教訓）與程式相反」的狀態。正確性不受影響（partial unique 約束＋23505 retry 仍保 race-safe），純屬效率／一致性，故 P2。與 F-019（同屬 T70 get-or-create 設計）相關但根因不同：F-019 是「首次訪客 token 尚未存在時的競態未涵蓋」，本項是「已選定的並發策略在 hot path 上選錯形態」。
- 修法：把 `addToCart` 的 get-or-create 改為 **read-first**——先 `SELECT cart WHERE guest_token=X` 命中即用（hot path 一次 round trip）；miss 才 `INSERT`；`INSERT` 撞 `23505`（真正的併發建立競態）再 reselect。保留 `uq_cart_guest_token` 作為競態兜底。如此常態路徑降回單次 SELECT，且與 §3.2 記載的教訓一致。**替代方案**：若刻意保留 insert-first（如程式簡潔優先、流量小到無感），依 §3.2「讓它是決策不是慣性」把理由寫進 T70／PR，並同步修正 §3.2 目前把 addToCart 列為 read-first 的範例（否則文件與程式互相矛盾）。工作量 ≤0.25 天，可與 T78（cart 限流／清理，同檔同模組）或 T81 同批處理。
- 記錄：2026-07-09 首次發現（本輪逐行複核 T70／PR #45 delta，對照同日新寫入的 coding-system §3.2 選型驗收判準，發現合併程式採 insert-first 與該判準明列的 addToCart read-first 結論相反）。

## F-021 [P2-low] 新 cron `/api/cron/cart-cleanup` 的 CRON_SECRET 比對非 timing-safe：與 F-012／T99（ecpay-reconcile）同根因、第二支 cron route

- 狀態：待確認
- 位置：`src/app/api/cron/cart-cleanup/route.ts:16-19`（`authHeader !== \`Bearer ${serverEnv.CRON_SECRET}\``，字串 `!==` 短路比對）
- 失敗情境：與 F-012／T99 完全同一根本原因（code-checklist **A4「驗證用 timing-safe 比對」**），只是換一支 cron route。字串 `!==` 逐字元短路比對理論上可被 timing attack 逐字元猜出 `CRON_SECRET`，猜到後可任意觸發訪客車清理批次（本身冪等、單次上限 500，無法竄改金額或多刪 member 車〔member_id 目前恆為 null 另見 F-022〕，故傷害有限）。實務可利用性極低（HTTPS 網路抖動遠大於字元比較時差、secret 高熵），但屬「**同根因、多點、修法只覆蓋一點**」型缺陷（同 F-001／F-006／F-017）：**T99 的任務描述只點名 `ecpay-reconcile` 這一支 cron，而 `cart-cleanup` 是 T99 開票（2026-07-07）之後才由 T78（PR #46）新增的第二支 cron**——若 T99 只照字面修 ecpay-reconcile，這支會被靜默留下、下輪審查必重新撞見。同 codebase 的 `check-mac-value.ts:54` 早已用 `timingSafeEqual`，兩支 cron 的 Bearer 比對卻仍是裸 `!==`（不對稱）。
- 修法：把 T99 的 timing-safe 修法（`crypto.timingSafeEqual`：先比長度、轉 Buffer；或抽一支共用 `verifyCronSecret(request)` helper 供兩支 cron route 共同 import，一次收斂避免第三支 cron 再重演）**一併套用到 `cart-cleanup`**。建議在 **T99 任務範圍與其對應 issue 直接補註「範圍含 cart-cleanup，共兩支 cron route」**，與 ecpay-reconcile 同批一次收斂。抽共用 helper 亦順帶消除「每支 cron 各自手刻 Bearer 比對字面量」的複本失同步風險。
- 記錄：2026-07-10 首次發現（本輪逐行審 T78／PR #46 新增的 `cart-cleanup/route.ts`，對照 F-012／T99 的 timing-safe 缺口發現同根因擴散到第二支 cron）。
- 追加（2026-07-13）：本項「抽共用 helper」的修法建議**已部分落地**——三支 cron（`ecpay-reconcile`／`cart-cleanup`／新增第三支 `pending-payment-expire`）現皆改呼叫共用 `src/lib/cron/require-cron-auth.ts:7-12`，消除了各自手刻 Bearer 比對字面量的複本失同步風險（F-021 修法的一半）。**但 timing-safe 的另一半仍未做**：`require-cron-auth.ts:9` 依舊是裸 `authHeader !== \`Bearer ${serverEnv.CRON_SECRET}\``。淨效果：F-012／F-021 的根因（非 timing-safe 比對）不但仍在，且已擴散為三支 cron 共用——好處是現在只需改這一處（`require-cron-auth.ts`）即可一次修好三支。**T99 修法建議更新**：改在 `require-cron-auth.ts`單點套`crypto.timingSafeEqual`（先比長度、轉 Buffer）即涵蓋全部三支 cron；任務範圍註記由「兩支 cron」更新為「共用 helper 一處，涵蓋三支 cron」。依去重不另開新編號，維持 F-021 待確認。

## F-022 [P2-low] cart-cleanup 的 DELETE 只綁 `id`、丟失 `member_id IS NULL`／`updated_at < cutoff` 守衛：SELECT→DELETE 之間被 touch／claim 的車仍被刪（TOCTOU）

- 狀態：待確認
- 位置：`src/app/api/cron/cart-cleanup/route.ts:47-51`（`.from("cart").delete().in("id", ids)`——DELETE 僅以 SELECT 階段撈到的 `ids` 過濾，未重新套用候選 SELECT `:30-36` 的 `.is("member_id", null)` 與 `.lt("updated_at", cutoff)` 兩個條件）
- 失敗情境：清理採「先 SELECT 候選 id（`member_id IS NULL` 且 `updated_at < now-90d`）→ 再依 id DELETE」兩步（為規避 PostgREST `.delete().order().limit()` 的 42703，方向正確）。但第二步 DELETE **不重新驗證** 候選當初入選的條件，兩步之間非原子——若某候選車在 SELECT 與 DELETE 的空窗被改動，仍會被以 id 刪掉：①**updated_at race**：一台剛好卡在 90 天邊界、被選為候選的訪客車，其擁有者在空窗內回站 `addToCart`／改量／移除→`touchCartUpdatedAt` 把 `updated_at` 推新（車已「復活」），但 DELETE 只認 id、照刪不誤，客人剛加的商品憑空消失。②**member_id claim（行為連鎖，隨 T81 兌現）**：T81（登入時把 guest cart 併入會員 cart、會設 `cart.member_id`）一旦落地，一台 90 天未動的訪客車被選為候選後，擁有者在空窗內登入→`member_id` 被設上（不再是訪客車），但 DELETE 仍照 id 刪掉會員剛併入的車。對照 `ecpay-reconcile` 的 promotion 用條件式 CAS（`.eq("status","pending")`）守住「入選條件在 mutation 當下仍成立」，本 DELETE 沒有等價守衛——屬 code-checklist **B2（狀態守衛缺失）／不對稱#7（SELECT 端的過濾條件，DELETE 端沒跟上）**。當前狀態機率可忽略（空窗為毫秒級、需 90 天棄置車在該毫秒回站，且 member_id 目前恆 null、情境②尚未兌現），故列 P2-low；價值在「與 codebase 既有 CAS 紀律一致」＋「T81 落地前先補起，免得屆時同檔改兩次」。附帶：`cart-cleanup` 目前無任何自動化測試（`ecpay-reconcile` 有 `route.test.ts`），這類守衛缺口正是測試該攔的類型。
- 修法：把候選條件一併加回 DELETE，成為 guarded delete——`.delete().in("id", ids).is("member_id", null).lt("updated_at", cutoff).select("id")`；空窗內被 touch／claim 的車因不再符合條件而自動存活，`deleted` 計數亦如實反映真正刪除數。一行擴充、行為更正確、零額外成本。可與 F-021 同批（同檔）；補一支 cart-cleanup route 測試涵蓋「候選在 DELETE 前被 touch 應存活」。
- 記錄：2026-07-10 首次發現（本輪逐行審 T78／PR #46 `cart-cleanup/route.ts`，對照 ecpay-reconcile 的條件式 CAS 而暴露此 DELETE 缺守衛的不對稱）。

## F-023 [P2] T111 代客建單付款連結把 order_no 定性為刻意散佈的持有型憑證：與 T73 計畫中「pay 頁綁擁有權」的修法直接衝突，並抬高弱亂數 order_no 的枚舉風險

- 狀態：已修復（PR #64，2026-07-14）——T73 修法正是照本項指出的方向落地：pay 頁**不**硬綁擁有權，改為「cookie 缺席即放行（保住 T111 冷連結／跨裝置付款）＋cookie 存在但不符才擋＋GET 加限流」；order_no 已換 crypto.randomInt。此 T73↔T111 行為連鎖耦合已在 PR #64 一併消化。隨 T73 結案。
- 位置：`src/app/admin/orders/checkout/actions.ts:23-27`（`buildPaymentLink` 把 `order_no` 塞進 `/checkout/pay?order=<orderNo>` 交給客人自行完成付款）；`src/lib/order/create-order-from-cart.ts:51-60`（`generateOrderNo` 仍用 `Math.random()`——32 字元去混淆字母表取 6 碼＝約 32^6≈1.07e9 空間、非密碼學強度）；`src/app/checkout/pay/page.tsx:93-101`（憑 `order_no` service-role 讀單、無 session／擁有權綁定，且該 GET 路由無限流）＋`:117-134`（外露 `ItemName`＝品名＋數量與 `TotalAmount`）＋`:178-183`（為該單 insert 一列 pending `payment`）
- 失敗情境：T111（PR #57）代客建單的收款設計是「建 `pending_payment` 訂單→產生付款連結 `/checkout/pay?order=<order_no>` 交給客人自行刷卡」。這讓 `order_no` **從隱含的識別碼變成刻意對外散佈的持有型憑證**（admin 透過 email／LINE／簡訊明文傳給客人），而 `/checkout/pay` 對任何持有該 order_no 的人開放：讀出品名＋數量＋總金額、並替該單建立 ECPay 付款表單與 pending `payment` row。由此衍生兩個具體問題——①**與 T73 修法直接衝突（行為連鎖）**：T73（P1，未開始）現行描述明訂「擁有權綁定須一併套用 success／pay／failed 三頁」；但代客建單的客人點的是**冷連結**，瀏覽器既無 admin 那張 cart 的 `guest_token`、也可能未登入——若 T73 照字面把 `/checkout/pay` 綁 session／guest 擁有權，**代客建單付款連結會直接失效**（客人無法付款），甚至客人自助結帳後把付款連結換到另一台裝置／瀏覽器開啟也會被擋。故 T73 的「三頁一律綁擁有權」對 pay 頁不成立，需改以「不可猜的憑證＋限流」取代。②**枚舉風險被抬高**：order_no 現在是憑證卻仍用 `Math.random()` 產生、pay 頁又無限流，攻擊者枚舉 `INC-<今日>-XXXXXX` 命中某張 `pending_payment` 訂單即可看到其品項與金額、並觸發 payment row 建立（雖 1.07e9／日＋72h 逾期窗口使大規模枚舉不切實際，但設計上已把 order_no 當憑證用卻無密碼學強度與速率保護）。與 T73／F-006 同根本區域（order_no 即權限＋弱亂數），但本項是 **T111 上線後才出現的新維度**：它把「pay 頁能否綁擁有權」從安全強化翻轉成功能前提，必須反映進 T73 的修法設計。
- 修法：**針對 `/checkout/pay` 專頁**，不採 T73 對 success 頁的「綁 session／guest 擁有權」路線（會破壞付款連結），改為：①`generateOrderNo` 換 `crypto.getRandomValues`（T73 已含此子項，本項把它的優先級與理由補強——order_no 已是對外散佈憑證）；②對 GET `/checkout/pay` 加速率限制（沿用 `src/lib/rate-limit.ts` Upstash 基礎設施，以 IP 為 key），壓制枚舉；③（可選、更穩健）為付款連結引入與 order_no 解耦的獨立高熵簽章 token 參數，pay 頁驗 token 而非只認 order_no。success／failed 頁的擁有權綁定仍照 T73 原案。**建議在 T73 任務描述與 issue #15 補註「pay 頁因 T111 付款連結為冷連結，改走『crypto order_no＋限流』而非擁有權綁定，success／failed 維持綁定」，並在 T73 與 T111 的依賴欄互相註明此耦合**（reporting.md 批次耦合「行為連鎖」型）。
- 記錄：2026-07-13 首次發現（本輪逐行審 T111／PR #57 `admin/orders/checkout/actions.ts`＋`create-order-from-cart.ts`＋`checkout/pay/page.tsx`；對照 T73／F-006 的 pay 頁擁有權綁定計畫，發現 T111 付款連結設計使該計畫對 pay 頁不成立、且把 order_no 弱亂數從強化項翻成安全前提）。

---

## 既有列管任務回歸狀態（2026-07-02 確認仍在列管、未修）

本輪走讀 money chain 與購物車／auth／email，逐一確認下列既有審查任務（T67–T83／GitHub #9–#25）皆**尚未修復、仍有效**，依去重規則不重報：

> **2026-07-03 排程審查再確認**：`git log` 顯示自上輪審查（commit `2503267`）後 `src/` 全無變動（其後皆 docs／skills commit），故 T67–T83 逐條維持原狀、位置行號不變。本輪新讀金流鏈三支＋checkout success/failed/pay＋login/auth/proxy＋admin/account，新增 F-005（開放轉址）、F-006（T73 根因未涵蓋 pay/failed）。

> **2026-07-07 全面風險審查再確認**：自上輪後 `src/` 再變動——PR #31（T37 Sentry）／#32（T30b 出貨通知信）／#33（T89 主動對帳）合併。**T37／T30b／T89 實作皆複核正確**（Sentry 已接進 notify／send-once／reconcile 的既有靜默失敗點；出貨信有 escapeHtml＋sendOnce 去重；對帳 cron 的 CAS／金額核對／`{error}` 檢查／限流退避齊全）。既有列管逐條再確認：**T70／T71／T72＋T84／T73（三頁）／T74／T75／T76／T77／T78／T79／T81／T86／T87／T88／T92 全數仍在**（本輪均逐行重看對應程式碼）；T80／T82／T83 未動（env 範圍本輪未跑）。特別註記：①T72/T84 的修復成本已下降——共用 `escapeHtml()` 已隨 T30b 落地（`src/lib/email/escape-html.ts`），剩下把三支舊寄信程式的插值套上；②T88 **不因 T89 而緩解**——對帳只撈 `status='pending'` 的 payment，「webhook 成功但寄信失敗」的訂單 payment 已是 paid，對帳永遠不會碰到它，信件仍會永久卡在 failed；③T89 已 merge 但 tasks.csv 未結案回寫。

> **2026-07-04 排程審查再確認**：自上輪（`73ebfbe`）後 `src/` **已變動**——PR #30（T67／T68／T69）與 PR #29（T85）合併。**T67／T68／T69／T85 已修復並複核正確、移出待修清單**（見下方 ✅ 標記與本輪審查記錄）。其餘 T70／T71／T72／T73／T74／T75／T76–T81／T82／T83 對應程式本輪未變動（`checkout/actions.ts`、`cart/*`、三支寄信程式的 escape 缺口、`state-machine.ts` shipOrder 順序等），逐條**確認仍在**。T88（sendOnce never-throw 缺口）於本輪逐行審 `send-once.ts` 再確認屬實、仍待架構決策。新增 F-007（狀態機併發守衛缺失）。

> **2026-07-09 排程審查再確認**：自上輪（2026-07-08）後 `src/`／`supabase/` **已變動**——PR #45（T70）／PR #48（T80）／PR #49（T86）合併（另 PR #44 T101 CI 屬 `.github/`）。逐條處置：**T70（#12, P0）已修復並複核正確**（`uq_cart_guest_token` partial unique＋`addToCart` 23505-retry；本輪另發現 hot-path 選型問題 F-020，屬效率而非正確性）→移出待修清單；**T86（#—, P1）已修復**（`safe-redirect.ts`，F-005 改已修復）；**T80（PII 稽核落表，非審查發現任務）已完成並複核正確**（`logPiiAccess` async／throw／fail-closed＋migration 0009 合規）——同時消解 architecture.md G-06。其餘 **T71／T72＋T84／T73（三頁）／T74／T75／T76／T77／T78／T79／T81／T87／T88／T92** 對應程式本輪未變動，逐條**確認仍在**；T82／T83（env）本輪跳過。已列管的 F-018／F-019（T70 PR review 追加）／F-017（account 讀取 `{error}`）維持待確認、依去重不重報。

> **2026-07-10 排程審查再確認**：自上輪（2026-07-09）後 `src/`／`supabase/` **已變動**——**PR #46（T78 購物車寫入限流＋guest cart 過期清理）合併**（唯一變動來源）。逐條處置：**T78（#20, P2）已修復並複核正確**（`cartWriteIpRatelimit`／`cartWriteTokenRatelimit` 套進 addToCart／updateCartItemQuantity／removeCartItem；新 `/api/cron/cart-cleanup` 90 天訪客車清理＋CASCADE；cookie 30 天 rolling；`touchCartUpdatedAt` 補 cart_item 不連動父層 updated_at 的缺口）→移出待修清單。本輪另於 T78 新程式發現 **F-021（cart-cleanup CRON_SECRET 非 timing-safe，同 T99 根因第二支 cron）／F-022（cleanup DELETE 缺守衛 TOCTOU）**，皆 P2-low、不影響 T78 主功能正確性；F-017 追加一個未列舉 location（`support/actions.ts` 訂單擁有權 SELECT 忽略 `{error}`）。**T78 隨手修好一個既有潛伏 bug**：OTP 三個 ratelimit instance 原皆未給 `prefix`，`otpIp`／`otpVerifyIp`（同以 IP 為 identifier）共用預設 key 互汙計數——本輪 5 個 instance 全加專屬 prefix，複核正確、視為既有缺陷已修復。其餘 **T71／T72＋T84／T73（三頁）／T74／T75／T76／T77／T79／T81／T87／T88／T92** 對應程式本輪未變動，逐條**確認仍在**（T78 已移出）；T82／T83（env）本輪跳過。**F-020（addToCart insert-first）本輪再確認仍在**——PR #46 對 `addToCart` 只加了限流與 `touchCartUpdatedAt`，`:107-134` 的 insert-first get-or-create 未動；依去重不重報，維持待確認。已列管的 F-017／F-018／F-019 維持待確認、依去重不重報。

> **2026-07-13 排程審查再確認**：自上輪（2026-07-10）後 `src/`／`supabase/` **大幅變動**——PR #53（T92）／#54（T72＋T84）／#55（F-011/T98）／#57（T111）／#56（T09）／#58（T40）／#60（T11）／#59（T10）合併，migration 0010–0013 首次入審。逐條處置：**T92（F-007）已修復並複核正確**（`adminOverrideStatus` 補 `.eq("status", from)` CAS＋`to===from` 前置擋下，`transitionOrder` 亦有 CAS 守衛）→ **F-007 早已標已修復**；**T72＋T84（F-001）已修復複核正確**（三支寄信程式全走 `escapeHtml`）；**F-011（T98）已修復複核正確**（`uq_orders_one_pending_per_cart` partial unique＋23505 constraint-name 分類）；**T111（代客建單）新程式品質良好**（見審查記錄）。**新增第三支 cron `pending-payment-expire`（T66）複核正確**（CAS 守衛＋per-item try/catch＋payment sweep＋已在 `vercel.json` 排程，無 G1）。其餘逐條**確認仍在**：**T73（三頁 order_no 存取控制＋crypto 亂數，本輪 F-023 補 T111 付款連結新維度）／T77（shipOrder 先寫 tracking_no 後驗 transition，`admin/orders/[id]/actions.ts:55-74` 本輪複核仍為 write-before-validate）／T79（findOrCreateMember 已於他處改 throw，但 T79 原指的吞錯位置範圍待核）／T81（cart.member_id 未用）／T88（sendOnce never-throw）／T96（F-009：notify fallback `:54` 仍 inline slice 重組，未收斂單一出處）／T99（F-012：cron timing-safe，見 F-021 追加——已收斂共用 helper 但仍非 timing-safe）／T108（F-015：`面交` 前綴仍在 `order-actions.tsx:80` 寫入端與 `order-shipped-notification.ts:12` 解析端各手刻一份）／T110（CAS＋log-insert 未交易化）**；**F-017（account 讀取頁忽略 `{error}`）本輪再確認仍在**（`account/orders/page.tsx:11` 等未動）；F-018／F-019／F-020 維持待確認、依去重不重報。T82／T83（env）本輪跳過。migration 0010–0013 首次逐行審：`create_order_with_items`（SECURITY INVOKER＋`revoke execute from public/anon/authenticated`＋`set search_path=''`）、`uq_orders_one_pending_per_cart`（partial unique）、`product_image`（FK CASCADE＋RLS deny-by-default＋僅 active 商品公開唯讀＋updated_at trigger）、`uq_product_image_product_sort`＋`insert_product_image`／`move_product_image` RPC（原子取號／交換，row lock 序列化），**皆合規、每個約束與 RPC 都找到程式使用點，無 S7/G1 機制虛設、無新 schema 發現**。

- **T67（#9, P0）** ✅ **已修復（2026-07-04，PR #30）**：`order-result/route.ts` 改 `slice(11,17)`。
- **T68（#10, P0）** ✅ **已修復（2026-07-04，PR #30）**：外層 catch 改回 `0|Internal Error`；正常/fallback 兩路徑皆加 `TradeAmt` 金額核對。PR merge 前的三輪 `/code-review ultra` 追加發現並修復：`ensureOrderPaid`／`ensureNotificationSent`／payment UPDATE 皆補上 Supabase `{error}` 檢查（原本只看 `data`，暫時性 DB 錯誤會被誤判成功、訂單卡在 `pending_payment` 無法自癒）。
- **T69（#11, P0）** ✅ **已修復（2026-07-04，PR #30）**：email 寄送改 `await`；新增 `src/lib/notification/send-once.ts` 落實 `notification` 表 `unique(order_id,type)` 去重（claim/reclaim/stale-pending）。**已知殘留缺口**：`sendOnce` 的 never-throw 契約讓「寄信本身失敗」這個情境的自癒機制打不到（webhook 仍回 `1|OK`，ECPay 不會重送觸發重試）——登記為 **T88** 另外處理，屬架構決策不阻塞本次 merge。
- **T70（#12, P0）** ✅ **已修復（2026-07-09，PR #45）**：`uq_cart_guest_token` partial unique index（migration 0008）＋`addToCart` 23505-retry。本輪新發現 hot-path 選型問題→見 F-020（P2，效率／一致性，不影響正確性）。
- **T71（#13, P1）** ✅ **已修復（2026-07-11，PR #50）**：`checkout/actions.ts` 訪客分支 email 命中既有會員時改回傳 `requiresLogin`（不再靜默掛單），新建帳號競態撞號分支回傳同一結果物件避免文案洩漏帳號存在與否。`/code-review ultra` 追加修復：createOrder 加 IP＋guest_token 限流（防 requiresLogin 被當帳號枚舉 oracle）；抽出 `normalizeEmail()` 單一出處，登入態分支也套用；建帳競態分支改先判 Supabase 結構化錯誤碼；`requiresLogin` 顯示時停用送出鈕。開發期間 T76（PR #51）同步把 createOrder 改走 RPC，二次合併 master 解決重疊，187 測試全綠。
- **T72（#14, P1）** ✅ **已修復（2026-07-12，T72／T84／PR #54）**：三支寄信程式全數改用共用 `escapeHtml()`；checkoutFormSchema 補長度上限（含 F-001 涵蓋的第三支 `support-request-notification.ts`）。
- **T73（#15, P1）** 成功頁仍憑 order_no 揭露個資；`generateOrderNo` 仍用 `Math.random`（`checkout/actions.ts:24`）。**確認仍在。**（本輪並發現同根因未涵蓋 pay／failed 兩頁→見 F-006，修 T73 時範圍須擴至三頁。）
- **T66（P1）** ✅ **已修復（2026-07-11，PR #51）**：`/api/cron/pending-payment-expire`（72h 未付款自動轉 cancelled）＋ `transitionOrder` 補 CAS 守衛（`OrderTransitionRaceError`）。
- **T74（#16, P1）** ✅ **已修復（2026-07-11，PR #51）**：`pay/page.tsx` 逾 30 分鐘未付款換發新 merchant_trade_no、舊 row 標 failed；本機三代理深度審查（比照 ultra）另修復 mark-failed 缺 CAS 守衛、併發掃除 mutual-kill、webhook 端 0 列更新的救援路徑。
- **T75（#17, P1）** ✅ **已修復（2026-07-11，PR #51）**：`orders.cart_id`（migration 0010）＋ `ensureOrderPaid` 付款成功才清車；深度審查另修復 cart 被追加新品項時不再整張保留（改精準移除已購品項）、重複結帳 dedup 誤導客人付舊單金額的問題。
- **T76（#18, P2）** ✅ **已修復（2026-07-11，PR #51）**：`create_order_with_items` plpgsql function（migration 0010）單一交易包裹 order＋order_item；migration 0011 收回 RPC 的 anon/authenticated 執行權（驗價紅線縱深防禦）。
- **T78（#20, P2）** ✅ **已修復（2026-07-10，PR #46）**：cart 寫入限流（IP＋guest_token 雙軌）＋ `/api/cron/cart-cleanup` 90 天訪客車過期清理；本輪新發現 F-021（cart-cleanup CRON_SECRET 非 timing-safe）／F-022（cleanup DELETE 缺守衛），皆 P2-low、不影響主功能。
- **T77／T79／T81（#19,#22,#23, P2）** shipOrder 順序、findOrCreateMember 吞錯、cart.member_id 未用——本輪未見修復跡象。**確認仍在。**（T66／T74／T75／T76 已於 2026-07-11／PR #51 完成、T78 已於 2026-07-10／PR #46 完成、T80 PII log 留存已於 2026-07-09／PR #48 完成。）
- **T82（#25, P0）／T83（P0）** 環境設定（Vercel env 分離／Supabase Auth production）——本輪跳過 env 範圍（無憑證），依既有列管，不變。
- schema 範圍：migrations 0003–0006 逐一檢視，皆遵循帳務鏈 RESTRICT／RLS deny-by-default／revoke delete／updated_at trigger／FK 索引慣例（0006 support_request 尤其齊全）；**2026-07-09 補審 migration 0008／0009**——0008（`uq_cart_guest_token` partial unique，比照 `uq_payment_one_paid_per_order` 寫法）、0009（`pii_access_log`：RLS deny-by-default 無 policy＋revoke update/delete＋actor_id/order_id FK RESTRICT＋兩支 FK 索引＋append-only 無 updated_at），皆合規且找到程式使用點（0008↔addToCart／read-cart 的 maybeSingle 假設；0009↔`logPiiAccess`），**無 S7/G1 機制虛設、無新 schema 發現。**

---

## 老化提醒

- **待確認超過 14 天的發現**：無（門檻 14 天）。仍待確認者：**F-017（2026-07-08，P2；2026-07-10 追加 support/actions.ts location）／F-018（2026-07-09，P2-low）／F-019（2026-07-09，P2-low）／F-020（2026-07-09，P2）／F-021（2026-07-10，P2-low；2026-07-13 追加共用 helper 進度）／F-022（2026-07-10，P2-low）／F-023（2026-07-13，本輪新發現，P2）**——皆在 14 天門檻內。⚠️ 提醒：F-017～F-020 已達／逼近門檻邊緣（最早 2026-07-08，距今 5 天），建議使用者本輪一併裁決是否轉任務。已處理：F-014→T107、F-015→T108、F-002→T93、F-003→T94、F-008～F-013→T95～T100（使用者 2026-07-08 確認轉任務）、F-016 併入 T95。F-007 已轉 T92（已修復）、F-005 已修（T86）、F-006 已併入 T73、F-004 已修（T85）——均不再計入待確認。
- **從未審查過的檔案（覆蓋表中審查次數＝0）**：本輪逐行補審 T09／T10／T11／T111 新增的**業務邏輯／schema** 檔（admin actions 三支、`create-order-from-cart.ts`、`require-cron-auth.ts`、`product/schema.ts`、`storage/*`、`normalize-email.ts`、migration 0010–0013、`pending-payment-expire/route.ts` 等，均首次入表，見覆蓋表 2026-07-13 列）。**仍未逐行審（次數＝0，留下輪輪替）**：T09/T10/T11/T111 的**展示層與純 helper**——`admin-checkout-form.tsx`／`admin-product-form.tsx`／`admin-nav.tsx`／`admin-notify.tsx`／`admin-pill.tsx`／`admin-filter-pills.tsx`／`mobile-nav.tsx`／`saved-banner.tsx`／`ui/skeleton.tsx`／`image-manager.tsx`／`admin/page.tsx`／`admin/products/{page,new/page,[id]/page,[id]/images/page}.tsx`／`lib/zod/flatten-field-errors.ts`／`lib/support/{schema,support-request}.ts`（後二支本輪僅間接經 admin actions 觸及）＋各 `loading.tsx` 骨架；另 **`src/types/database.types.ts`（生成檔，免審）**。這些多屬 client 展示與已由 server action 二次驗證的低風險層，故本輪優先金流／schema，展示層留下輪。建議下一輪：①逐行補審上列展示層／helper；②env 範圍（俟雲端憑證可用）；③高風險區隨各修復 PR 落地時複審。

---

## 檔案覆蓋表

> 母集＝`git ls-files` 排除純資產。「審查次數」自本檔首建（2026-07-02）起計；先前 2026-07-02 產生 T67–T83 的審查未留覆蓋表，故未計入。本輪實際逐行讀過者標日期＋1，其餘暫記 0（＝正式輪替尚未覆蓋，非零風險）。

| 路徑                                                                 | 最後審查日期                     | 審查次數 |
| -------------------------------------------------------------------- | -------------------------------- | -------- |
| src/app/api/ecpay/notify/route.ts                                    | 2026-07-13                       | 4        |
| src/app/api/cron/ecpay-reconcile/route.ts                            | 2026-07-07                       | 1        |
| src/lib/ecpay/query-trade-info.ts                                    | 2026-07-07                       | 1        |
| src/lib/order/ensure-paid.ts                                         | 2026-07-13                       | 2        |
| src/lib/notification/send-once.ts                                    | 2026-07-07                       | 2        |
| src/app/api/ecpay/order-result/route.ts                              | 2026-07-07                       | 3        |
| src/app/checkout/actions.ts                                          | 2026-07-13                       | 4        |
| src/app/checkout/pay/page.tsx                                        | 2026-07-13                       | 5        |
| src/lib/quote/verify-prices.ts                                       | 2026-07-07                       | 2        |
| src/lib/email/order-confirmation.ts                                  | 2026-07-04                       | 2        |
| src/lib/email/new-order-notification.ts                              | 2026-07-04                       | 2        |
| src/lib/email/support-request-notification.ts                        | 2026-07-04                       | 2        |
| src/lib/email/order-shipped-notification.ts                          | 2026-07-13                       | 2        |
| src/lib/email/escape-html.ts                                         | 2026-07-07                       | 1        |
| src/app/account/orders/[id]/support/actions.ts                       | 2026-07-10                       | 2        |
| src/lib/support/support-request.ts                                   | 2026-07-10                       | 2        |
| src/lib/support/schema.ts                                            | 2026-07-02                       | 1        |
| src/app/admin/orders/[id]/actions.ts                                 | 2026-07-13                       | 6        |
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
| src/app/products/[slug]/actions.ts                                   | 2026-07-10                       | 4        |
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
| src/proxy.ts                                                         | 2026-07-03                       | 1        |
| src/lib/auth/require-user.ts                                         | 2026-07-03                       | 1        |
| src/lib/auth/find-or-create-member.ts                                | 2026-07-13                       | 3        |
| src/lib/cart/read-cart.ts                                            | 2026-07-07                       | 1        |
| src/lib/cart/get-cart-count.ts                                       | 2026-07-07                       | 1        |
| src/lib/checkout/schema.ts                                           | 2026-07-13                       | 2        |
| src/lib/account/schema.ts                                            | 2026-07-07                       | 1        |
| src/lib/order/state-machine.ts                                       | 2026-07-13                       | 3        |
| src/lib/order/order-status.ts                                        | 2026-07-04                       | 1        |
| src/lib/pii/audit.ts                                                 | 2026-07-09（T80 落表複核）       | 2        |
| src/lib/pii/mask.ts                                                  | 2026-07-07                       | 1        |
| src/lib/rate-limit.ts                                                | 2026-07-10                       | 2        |
| src/lib/get-client-ip.ts                                             | 2026-07-10（首次，T78）          | 1        |
| src/lib/cart/touch-cart-updated-at.ts                                | 2026-07-10（首次，T78）          | 1        |
| src/app/api/cron/cart-cleanup/route.ts                               | 2026-07-10（首次，T78）          | 1        |
| src/lib/env.server.ts                                                | 2026-07-07                       | 2        |
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
| src/lib/order/create-order-from-cart.ts                              | 2026-07-13（首次，T111）         | 1        |
| src/lib/cron/require-cron-auth.ts                                    | 2026-07-13（首次，T78/T111）     | 1        |
| src/lib/admin/action-result.ts                                       | 2026-07-13（首次，T09）          | 1        |
| src/lib/concurrency-message.ts                                       | 2026-07-13（首次，T92）          | 1        |
| src/app/admin/layout.tsx                                             | 2026-07-13（首次，T09）          | 1        |
| src/app/admin/products/actions.ts                                    | 2026-07-13（首次，T10）          | 1        |
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

> 註（2026-07-07）：本輪聚焦 PR #31／#32／#33 delta（Sentry／出貨通知信／T89 對帳鏈）＋大規模輪替補審 20+ 支未審檔（checkout 鏈前端、cart 讀取、auth confirm、account actions、supabase server/service-role、env 兩支、next.config、vercel.json、pii/mask、admin order-actions、checkout-form 等）。測試檔（`__tests__`／`*.test.ts`）不計入覆蓋表。已移除歷史誤植列 `src/app/api/ecpay/aio-payment（見 …）`。

> 註（2026-07-08）：`src/` 自 PR #33 起無變動；本輪把覆蓋輪替推向剩餘的 schema `0001`／`0002`／`0003`＋`seed.sql`（schema 範圍首次逐行）與 account／PDP／純 UI 展示層共 24 檔。至此覆蓋表僅 `layout.tsx`／`ui/page.tsx`／`ui/button.tsx`／`database.types.ts`（生成檔）審查次數仍為 0，皆無業務邏輯。schema 三支複核結論：enum／RESTRICT 帳務鏈／RLS deny-by-default／`revoke delete` 帳務四表／`updated_at` trigger（append-only 表除外）／FK 與查詢索引齊全；partial unique `uq_payment_one_paid_per_order`、`raw_callback`、`gateway_trade_no`、`last_reconciled_at` 皆有程式使用點，無 S7/G1 機制虛設，本輪無新 schema 發現。

> 註（2026-07-09）：本輪逐行複核三支 PR delta（T70／T80／T86）並補審其新檔（`safe-redirect.ts`、migration `0008`／`0009`）＋收尾 3 支從未審過的純 UI 檔（`layout.tsx`／`ui/page.tsx`／`ui/button.tsx`）。至此覆蓋表僅 `src/types/database.types.ts`（Supabase 自動生成）審查次數仍為 0——無需人工逐行審。T80／T86 複核正確、F-005 改已修復；新發現 F-020（addToCart insert-first 與 §3.2 read-first 教訓相反，P2）。測試檔（`__tests__`／`*.test.ts`：本輪新增 `add-to-cart.test.ts`／`safe-redirect.test.ts`／`audit.test.ts`）不計入覆蓋表。

> 註（2026-07-13）：本輪逐行審 PR #57（T111 代客建單）／#56（T09）／#59（T10）／#60（T11）＋ migration 0010–0013 delta——首次入表 20 支業務邏輯／schema 檔（admin actions 三支、`create-order-from-cart.ts`、`require-cron-auth.ts`、`product/{schema,product-status,category-labels}.ts`、`storage/{product-images,constants}.ts`、`normalize-email.ts`、`admin/{layout,orders/checkout/page}.tsx`、`admin/action-result.ts`、`concurrency-message.ts`、`pending-payment-expire/route.ts`、migration 0010–0013）＋複核既有金流鏈與 admin 修復（notify／ensure-paid／checkout actions／pay 頁／state-machine／admin/orders/[id]/actions／find-or-create-member／require-admin／next.config／vercel.json／order-shipped/order-actions）。新程式全數 `requireAdmin()` 把關（D3 齊全）、magic-byte 圖片內容檢查、RPC 原子化取號／交換／建單、`create_order_with_items` revoke execute＋釘 search_path 皆到位，無 P0/P1；新發現 F-023（T111 付款連結 order_no 憑證化，與 T73 pay 頁擁有權綁定計畫衝突，P2）。**尚未逐行審**：T09/T10/T11/T111 展示層與純 helper（`admin-*.tsx`／`admin-product-form`／`image-manager`／`mobile-nav`／`flatten-field-errors`／admin/products 頁面群／loading 骨架等，見老化提醒），留下輪輪替。測試檔（本輪新增 `create-admin-order.test.ts`／`admin/products/__tests__/actions.test.ts`／`storage/__tests__/product-images.test.ts`／`create-order-from-cart.test.ts`／`pending-payment-expire/__tests__/route.test.ts` 等）不計入覆蓋表；image actions（uploadImage/deleteImage/moveImage）目前無專屬測試（RPC 邏輯在 DB 端）。

> 註（2026-07-10）：本輪逐行審 PR #46（T78）delta——變更檔 `cart/actions.ts`／`products/[slug]/actions.ts`／`checkout/actions.ts`／`login/actions.ts`／`rate-limit.ts` 與 3 支新檔（`api/cron/cart-cleanup/route.ts`／`lib/cart/touch-cart-updated-at.ts`／`lib/get-client-ip.ts`，皆首次入表）＋覆蓋輪替補審最久未審的 `check-mac-value.ts`／`support/actions.ts`／`support-request.ts`。T78 複核大致正確、隨手修好 OTP ratelimit prefix 共用 key 的既有潛伏 bug；新發現 F-021／F-022（皆 P2-low，cart-cleanup），F-017 追加 `support/actions.ts` location。覆蓋表僅剩 `database.types.ts`（生成檔）＝0。測試檔（本輪新增 `cart/__tests__/actions.test.ts`）不計入覆蓋表。cart-cleanup route 目前無測試（見 F-022 附註）。
