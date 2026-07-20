# incantochen 系統流程與 User Flow 統整

> 文件產出日期：2026-07-20
> 用途：把散落於 `user-flow.md`、`ops-runbook.md`、`tasks.csv` 與程式碼的行為，收斂成四層對齊視圖（User Flow → 系統流程 → 系統錯誤處理 → 人工救援）。
> 權威來源：程式碼（`src/lib/order/`、`src/app/api/`）與 `docs/ops-runbook.md` 為準；本檔為開發層對齊，過時就以程式碼修正。
> 現況座標：M-1/M0/M1 全完成 → **M2 進行中**（金流兜底、購物車失效偵測、自動化測試收尾）→ M3（後台 CRUD）→ M4（打磨/SEO）→ M5（上線必備）。核心閉環（瀏覽→配置→結帳→綠界付款→查單→售後）程式已跑通。

---

## 目錄

- [Level 1 — User Flow & Experience](#level-1--user-flow--experience使用者動線與體驗)
- [Level 2 — 系統流程（含成立條件與例外）](#level-2--系統流程含成立條件與例外狀況)
- [Level 3 — System Error and Handling](#level-3--system-error-and-handling系統層錯誤與自動處置)
- [Level 4 — Operation Handling](#level-4--operation-handling人工救援程序)
- [附錄 A — 訂單狀態機細節](#附錄-a--訂單狀態機細節)
- [附錄 B — 金流兜底：對帳三臂](#附錄-b--金流兜底對帳三臂)

---

## Level 1 — User Flow & Experience（使用者動線與體驗）

四條主動線，體驗原則：**自助、價格透明、低摩擦、不推銷**（呼應高端客群主導性、反感推銷）。

| # | 流程 | 動線 | 體驗關鍵 |
|---|------|------|----------|
| **F1** | **首購下單**（訪客→會員） | 商品目錄 → 詳情頁（含配戴情境圖）→ 頁內配置器（寶石色→金屬色→規格→數量）→ 即時報價 → 購物袋 → 結帳（Email＋收件＋黑貓宅配）→ 同意客製條款 → 綠界付款 → 結果頁 | **結帳即會員**（免先註冊）；付款結果頁「數秒內給明確結果」，絕不讓客人看到「待付款」而驚慌 |
| **F2** | **回訪查單** | 輸入 Email → 收信（**OTP 驗證碼為主＋magic link 為輔**）→ 輸碼登入 → 會員中心 → 訂單狀態時間軸／物流單號 | OTP 讓 session 精準落在**當下裝置**（手機輸入、桌機收信也不卡）；magic link 落地頁「**再按一次才消耗 token**」防掃描器點掉 |
| **F3** | **售後申請** | 訂單詳情 →「商品問題回報」→ 填說明＋同意告知 → 店家後台審核 → 狀態同步回客人端 | 半客製＝**法定客製品、無七天鑑賞退**；客戶端只有單一入口，退款走人工確認 |
| **F4** | **全客製預約** | 首頁 custom 入口 → 說明頁 → 需求表單（品項/預算/想法/聯絡）→ 通知店家 → 人工一對一 | MVP 僅捕捉需求，**不接金流、不建訂單**（完整報價鎖價＝Phase 3） |

**已落地頁面**：`/products/[slug]`、`/collections/[category]`、`/cart`、`/checkout`（含 `/pay` `/success` `/failed`）、`/login`、`/account/orders/[id]`、`/admin/orders`。

**半客製選配選項（依品類；數量為共通）**：
- 戒指：寶石顏色／金屬色／戒圍
- 耳環：寶石顏色／金屬色／耳針或耳夾
- 手鍊／項鍊：寶石顏色／金屬色／長度

---

## Level 2 — 系統流程（含成立條件與例外狀況）

### F1 首購下單（核心閉環，最複雜）

**正常路徑成立條件**：白名單選項合法 → 前端價＝後端重算價 → 勾選客製同意 → 綠界回報成功。

| 節點 | 系統動作 | 成立條件 | 例外處置 |
|------|----------|----------|----------|
| 配置器 | 三層白名單控制（類別 `applies_to` → 款式 `ProductOption` → 值 `ProductOptionValue`） | 選值在白名單內 | 前端不得繞過白名單；非法值後端拒絕 |
| 加入購物袋 | 寫 `unit_price_snapshot` ＋ `config_snapshot` 快照 | `cart.guest_token` 與 httpOnly cookie 一致（擁有權檢查） | token 不符 → 拒絕改動（防亂猜 id 動別人的車） |
| 購物袋頁·失效偵測（**T138 規劃中**） | `getCart` 對每筆 `cart_item` 比對現況（商品仍 `active` ＋每個已選 `option_type`/`option_value` 仍在白名單顯示中） | 全部有效 | 任一失效 → 標「該商品或選項已不存在，請重新下單」＋**停用「前往結帳」**直到移除；查詢失敗 fail-open（結帳端 `verify-prices` 為最終兜底）。與 T117（PDP 擋新加）互補——本項擋**已加入購物車**的失效品 |
| 結帳驗價 | **`verify-prices.ts` 依 DB 白名單重算**，絕不信任前端 | 前端價＝後端價 | 不一致 → 更新快照＋回 `priceUpdated`、**不建單**（R/S/Q loop，重跑驗價） |
| Email 辨識 | 以 Email 找/建會員 | 全新 email → 自動建會員 | **命中既有會員**（T71）→ 不靜默掛單，回「需先登入」導 `/login` OTP 驗證後導回 |
| 建立訂單 | 存訂單（待付款）＋同意內容＋時間戳 | 驗價通過 | — |
| 綠界付款 | 產 MerchantTradeNo（`order_no` 去 hyphen 17 字＋2 隨機＝19 字，單一出處 `merchant-trade-no.ts`） | — | — |
| **付款判定** | **背景 Webhook 為權威**；驗 CheckMacValue（SHA256）、冪等去重、條件式 UPDATE | Webhook 回報成功 | 前端 redirect 早於 webhook → 結果頁「確認付款中」輪詢 |
| **三態對帳** | 成功頁若未確認 → **主動呼叫綠界訂單查詢 API** 快速對帳 | 綠界明確回成功/失敗 | 「尚未確認」≠失敗：**不可顯示「失敗請重試」**（會雙重扣款）；逾時 60–90s → 「款項確認中，將 email 通知你」 |
| 付款成功 | 訂單→已付款、寄確認信＋通知店家＋開電子發票 | — | serverless 一律 `await`（禁 fire-and-forget） |
| 逾期未付 | T66：pending_payment 逾期（如 72h）自動取消；重試換新 trade no（T74） | — | 有 paid payment 就不准取消（守衛下沉在 `transitionOrder`） |

**關鍵決策點與邊界**：
- **付款判定以背景 Webhook 為準**：使用者可能中途關視窗、redirect 那條會遺失，背景通知仍會到。
- **輪詢逾時 ≠ 失敗（三態）**：已確認成功／已確認失敗／尚未確認；「尚未確認」屬處理中、很可能已付款，重試會雙重扣款。
- **重複扣款防護**：冪等去重（T53），狀態只前進一次；重付前先檢查是否已付款。
- **未勾選客製例外同意**：不可送出。
- **庫存**：不擋單，以交期告知管理。
- **配送**：僅黑貓宅配（保價＋本人簽收），🚫不做超商。

### F2 回訪查單

- **成立**：OTP 碼正確且未過期（碼長不假設固定位數，雲端 8 碼、本機 6 碼，採 4–10 位彈性）→ 建 session（落在輸碼/點擊的當下裝置）。
- **例外**：碼錯/過期 → 友善錯誤＋一鍵重寄；magic link token 失效 → 同；未登入存取受保護頁 → 導向登入。
- **magic link 落地頁須「再按一次登入」才消耗 token**：防 Outlook SafeLinks／防毒／預覽 bot 先 GET 把單次連結用掉。

### F3 售後申請

- **成立**：訂單狀態可申請（非待付款/已取消/已退款）→ service role 重驗訂單擁有權與資格 → 建 `support_request(return_defect, pending)` → 通知店家。
- **例外**：不可申請狀態 → 顯示不可申請導回；重複申請**不硬擋**（人工後台處理，防連點靠按鈕 disabled）。
- **界線**：半客製＝法定客製品、無七天鑑賞退；客戶端僅「商品問題回報」單一入口；`repair_maintenance` 僅後台手動登錄；退款走人工確認（T47）。

### F4 全客製預約

- **成立**：欄位完整 → 建預約/詢問紀錄 → 通知店家 → 顯示「已收到」。
- **邊界**：不接金流、不建訂單；沿用既有通知機制；完整報價鎖價製作＝Phase 3。

### 跨流程：訂單狀態機

`待付款 → 已付款/處理中 → 製作中 → 已出貨 → 已完成`；分支 `已取消 / 已退款`。每次變更寫 `OrderStatusLog`，狀態推進與稽核 log **交易化**（`transition_order_status` RPC，log 寫不進去整筆 rollback）。詳見 [附錄 A](#附錄-a--訂單狀態機細節)。

---

## Level 3 — System Error and Handling（系統層錯誤與自動處置）

源自 `CLAUDE.md §6` 防禦性寫法通則 ＋ 金流兜底設計。**核心哲學：暫時性故障自癒、錢務問題永不自動修。**

### 3.1 防禦性程式規則（已落地，動對應模組必守）

- **SDK 錯誤必檢查**：Supabase/Resend 用回傳值帶錯誤（不 throw），每次呼叫解構檢查 `error`；「查詢失敗」≠「查無資料」，`error` 非 null 一律 throw/明確處理。
- **並發去重用條件式 UPDATE**，且 SET 必須改動 WHERE 用到的欄位（否則 READ COMMITTED 下 EvalPlanQual 兩邊都搶到）。
- **numeric 欄位比對前先 `Number()`**（PostgREST 對 numeric 回字串）。
- **serverless 禁 fire-and-forget**：一律 `await` 或 `after()`/waitUntil。
- **識別碼格式互轉單一出處**（`merchant-trade-no.ts`），禁各處手刻。
- **客人輸入插 HTML 前先 `escape-html.ts`**。

### 3.2 金流失敗的自癒矩陣（webhook 已失靈為前提，客人在綠界已成功扣款）

| 失敗點 | 客人體驗 | 自動處置 | 自癒時間 |
|--------|----------|----------|----------|
| ① 訂單推進失敗（DB 暫時錯） | 付了款仍顯示待付款 | Sentry ＋ cron `unexpected`+1 | 隔日對帳冪等重試 |
| ② payment 翻 paid 失敗 | 幾乎無感（訂單已 paid、信照寄） | 隔日 CAS 補翻（短暫 `order=paid`/`payment=pending` 漂移屬正常，勿手動改） | 隔日 |
| ③ 確認信寄送失敗（T88） | 信晚到 | webhook 回 `0` 觸發重送 reclaim ＋ 每日 sweep 補寄 | 最慢隔天 |
| ④ webhook 側卡單（`payment=paid`/`order=pending`） | 付了款仍待付款 | T127 **漂移臂**隔日冪等推進＋補確認信 | 隔日 |
| ⑤⑥ 錢收在已取消/已退款訂單 | 訂單已取消卻被扣款 | **不自癒**——durable 稽核臂每日告警直到人工處理 | 需人工 |

**兜底層次**：Webhook（權威）→ 成功頁主動對帳查詢 API（即時）→ 每日 reconcile cron（[三臂](#附錄-b--金流兜底對帳三臂)）→ email-pending 最後安全網。全鏈路靜默失敗點已接 Sentry（T37）。

### 3.3 金額不符（P0）

webhook 端 `TradeAmt ≠ 系統金額` → **拒絕處理**、訂單停 `pending_payment`、不記帳。理論上不該發生（伺服器驗價），出現即當日開 bug 調查（`coding-system.md §3.5` 三問）。

### 3.4 webhook 失敗機率量級（工程推估，非實測）

| 層 | 單次失敗率 | 綠界重送能救 | 最終漏接 |
|----|-----------|-------------|---------|
| 網路暫時故障 | ~0.01–0.1% | ✅ 幾乎必救 | 接近 0 |
| Vercel 平台事故 | ≈99.95%+ 可用 | ⚠️ 看事故長度 | ~0.01–0.05% |
| 應用層（DB 暫時錯、bug） | ~0.01–0.1%/請求 | ✅ 回 ERR 觸發重送 | 接近 0 |
| **設定錯誤（ReturnURL/金鑰）** | **每次動設定 5–20% 人為出錯** | ❌ 全滅型、不自癒 | 一筆真實交易 100% 驗出 |

**結論**：設定正確前提下單筆「webhook 徹底失靈、要靠對帳搶救」約 0.01–0.1%（幾個月到幾年一次）。**風險大頭在設定層**，集中在 T35 換正式網域＋金鑰時——唯一預防是改完立刻打一筆真實小額交易驗 webhook 到達。

---

## Level 4 — Operation Handling（人工救援程序）

出處 `docs/ops-runbook.md`。**紀律**：修復 SQL 前先跑診斷查詢；能走 `/admin/orders`（寫稽核 log）就不裸改 SQL；**帳務表永禁 DELETE**。

**權威修復順序**：綠界後台 ＞ `payment` ＞ `orders` ＞ 通知信（永遠從權威端往下游同步，不反向）；先 payment、再 orders、最後補通知；一次一單（帶 `order_no`/`merchant_trade_no` ＋狀態守衛）。

| 情境 | 判斷 | 處置 |
|------|------|------|
| **訂單卡待付款、客人聲稱已付** | 綠界後台以 merchant_trade_no 查權威狀態 | ①等對帳兜底 ②手動觸發 cron ③仍不行才 SQL 改 payment ＋ Admin Override 推訂單 |
| **金額不符告警** | 比對 orders/綠界/`raw_callback` | **不可標 paid**；多收退刷、少收請補刷；P0 開 bug |
| **缺 `gateway_trade_no`** | 綠界查 TradeNo | UPDATE 回填 |
| **通知信卡 failed**（T88 已自動重試） | 連續 2–3 天同筆＝永久性 | Resend 查退信原因 → 聯絡客人 → 補寄 → 標 sent |
| **疑似重複扣款** | 兩筆都在綠界顯示已收款 | 保留最早成功那筆，其餘綠界退刷、系統標 refunded |
| **退款**（T47 記錄式） | 售後確認需退款 | 綠界後台退刷 → `/admin/orders/[id]` 退款區塊登記（`refund_order` RPC 原子：payment refunded ＋訂單 CAS ＋稽核 log ＋通知信） |
| **錢收在已取消/退款訂單**（§6.1） | 每日 durable 稽核臂告警 | 先聯絡客人：退款 or Admin Override 恢復訂單 |
| **對帳 Cron 失敗** | Vercel Cron 紀錄 ＋ pending 筆數是否累積 | 查 cron 啟用/route 200；ECPay 403 限流有退避隔日重試 |

**已知需人工的殘餘**：設計上的一天延遲（急件走 Admin Override）、錢收在已關閉訂單、金額不符、email 永久錯誤、重複扣款/退款——皆屬**錢務裁決，刻意不自動壓掉**。

**何時聯絡綠界（02-2655-1775）**：綠界查無交易但客人有扣款證明、退刷失敗、查詢 API 持續 403。準備 MerchantID、MerchantTradeNo（19 碼）、綠界 TradeNo、交易日期與金額。

---

## 附錄 A — 訂單狀態機細節

### A.1 狀態集合與合法轉換

**7 個狀態**（`src/lib/order/order-status.ts`）：

```
pending_payment → paid → in_production → shipped → completed
      │             │          │            │           │
      └→ cancelled  └──────────┴────────────┴───────────┴─→ refunded
```

**合法邊（`VALID_TRANSITIONS`，單一權威在 TS 端）**：

| from | 允許 to |
|------|---------|
| `pending_payment` | `paid`、`cancelled` |
| `paid` | `in_production`、`refunded` |
| `in_production` | `shipped`、`refunded` |
| `shipped` | `completed`、`refunded` |
| `completed` | `refunded`（T47：已完成客製品因瑕疵協議退款是合法情境） |
| `cancelled` | —（終止） |
| `refunded` | —（終止） |

終止狀態只剩 `cancelled` 與 `refunded`；`completed` 因售後退款需求**不再是終止狀態**。付款成立契約集合 `PAID_LINEAGE = [paid, in_production, shipped, completed]`（決定哪些狀態下該補寄確認信、視為付款已成立）。

### A.2 每條邊：觸發者 / 守衛 / 後續動作 / 例外

| 邊 | 觸發者 | 成立條件 | 後續動作 | 例外處理 |
|----|--------|----------|--------|----------|
| `pending → paid` | **webhook**（權威）／**reconcile cron**（兜底），走 `ensureOrderPaid` | CAS `WHERE status='pending_payment'` 搶到 | 清購物車（T75）＋寄確認信＋通知店家＋開發票 | CAS 沒搶到 → 複查：`already-settled`（正常冪等）／`closed`（P0 告警）／`indeterminate`（不可當 closed） |
| `pending → cancelled` | **逾期 cron**（T66, 72h）／admin，走 `transitionOrder` | canTransition ✅ **且無 paid payment** | 寫稽核 log | 有 paid → `PaidOrderCancelBlockedError`；cron 記 `paidConflict`＋告警、結帳回錯不建新單、admin 導退款 |
| `paid → in_production` | **admin 手動** | canTransition ✅ ＋ CAS | 稽核 log | 競態 → `OrderTransitionRaceError`（跳過非失敗） |
| `in_production → shipped` | **admin 手動** | canTransition ✅ ＋ CAS | 稽核 log ＋寫 `tracking_no` ＋寄出貨通知 | 狀態已轉但單號寫入失敗 → 回 **warning**（非 error），提示「修正物流單號」補填 |
| `shipped → completed` | **admin 手動** | canTransition ✅ ＋ CAS | 稽核 log | 競態 → `OrderTransitionRaceError` |
| `* → refunded`（PAID_LINEAGE） | 後台**退款區塊**（T47），走 `refundOrder` → `refund_order` RPC | **先翻 payment=refunded 再 CAS 轉訂單**（單一交易） | payment refunded ＋ order refunded ＋ 稽核 log ＋ 退款通知信（sendOnce 去重） | 仍有 paid 殘留 → `RefundPaymentNotFlippedError`；pending/cancelled 不可走退款區塊 |

**逃生口 `adminOverrideStatus`**：繞過 `VALID_TRANSITIONS`，可改任意狀態（`operatorId` ＋ `reason` 必填）；仍走同一 RPC 享 CAS 守衛；前置擋 `to === from`（避免 EvalPlanQual 下 CAS 失效）。**不翻 payment、不寄通知信**——留下的半套狀態（訂單 refunded / payment 仍 paid）由 reconcile 稽核臂每日告警直到人工「補登記退款」（`repair_refunded_payment` RPC, 0021）。

### A.3 並發不變式（狀態機硬核）

所有寫入唯一經過 `transition_order_status` RPC（migration 0017），在 DB 端**單一交易**內完成 `CAS UPDATE orders + INSERT order_status_log`，任一段失敗整段 rollback（T110）。

1. **條件式 CAS（`WHERE status = p_from`）**：兩個近乎同時抵達的請求只有一個搶到、只寫一筆 log。沒搶到回空集合，呼叫端以 `OrderTransitionRaceError` 分流為「良性競態」。
2. **`from = to` 前置守衛（TS ＋ RPC 雙層）**：目標＝現況時 SET 不改動 WHERE 用到的 `status`，READ COMMITTED 下 CAS 因 EvalPlanQual 失效——故直接擋下。
3. **取消守衛 TOCTOU 補洞**：pre-guard 查無 paid → CAS 取消 commit → **commit 後再查一次**。毫秒窄窗內若 webhook 才翻 payment=paid，偵測到 → 發 `money received on order cancelled during transition` P0 告警（人工裁決）。查詢失敗只降 warning。

### A.4 守衛分層總表

| 層 | 守衛 | 防的是 |
|----|------|--------|
| TS `canTransition` | 合法邊白名單 | 業務邏輯非法跳轉 |
| TS 取消/退款守衛 | 有 paid 就不准取消/轉退款 | 錢在訂單上卻靜默消失 |
| RPC CAS `WHERE status=from` | 條件式 UPDATE | 並發雙寫、稽核 log 重複/矛盾 |
| RPC 單一交易 | UPDATE+INSERT 原子 | 「狀態已變、log 缺漏」中間態 |
| RPC `from=to` raise | EvalPlanQual 防護 | 同目標並發覆寫都通過 |
| reconcile 稽核臂 | 每日 durable 掃描 | Override 逃生口/TOCTOU 窄窗留下的半套 |

---

## 附錄 B — 金流兜底：對帳三臂

出處 `src/app/api/cron/ecpay-reconcile/route.ts`。webhook 是即時路徑，reconcile cron 是最終防線（Vercel Cron 每日 02:00 台北、逐筆節流 400ms、`maxDuration 300s`）。三條臂各有一組**不相交的候選鍵**——以某一鍵查詢的臂看不見另一鍵的漂移單，所以必須三臂並存。**任一子臂查詢失敗 → 整支回 HTTP 500（fail-visible）。**

### B.1 為何三臂缺一不可（候選鍵覆蓋矩陣）

| 異常態（payment × orders） | 成因 | 撈得到的臂 | 處置 |
|---------------------------|------|-----------|------|
| `pending` × `pending_payment` | webhook 漏接（沒收到回呼） | **主臂**（打綠界確認） | 自癒推進 |
| `paid` × `pending_payment` | webhook 側卡單（推進訂單失敗） | **漂移臂**（信任財務事實） | 自癒推進 |
| `paid` × `cancelled` | 取消守衛 TOCTOU／既有列 | **稽核臂** · cancelled | 人工裁決 |
| `paid` × `refunded` | Override 不翻 payment／legacy | **稽核臂** · refunded | 人工裁決 |

### B.2 主臂（打綠界確認）

- **候選鍵**：`payment.status='pending'` ∧ 年齡 > 10min ∧ 冷卻 20h ∧ 上限 30。
- **流程**：`queryTradeInfo` 向綠界查權威狀態 → `validateSettleAmount` 白名單核對金額 → ①先推進訂單 `ensureOrderPaid`（CAS）②payment 翻 paid **留最後**（候選鍵存活，失敗隔日重試；F-014）③補寄信/開票。
- **金額不符/失敗碼**：**只告警、絕不自動改狀態**（payment 留 pending＝每日催辦，人工處理完告警自止）。
- **早期預警**：撈滿 30（`candidatesSaturated`）＝webhook 大面積失靈訊號，成因在 webhook 端非對帳。
- **中止條件**：`RateLimitError` / `QueryTradeInfoHttpError` → `break`；連續 403 達門檻升級 error（疑似金鑰/CheckMacValue 失效）。

### B.3 漂移臂（不打綠界）—— 完整說明

漂移臂是三臂裡最反直覺的一條：它**不打綠界**卻敢直接推進訂單。

**① 它在救哪種單：webhook 側卡單**

webhook 的 `settlePaid` 順序是**先翻 `payment=paid`，再推進訂單**。若第二步失敗、且 ECPay 重送額度耗盡，就停在：

```
payment.status = 'paid'            （錢已入帳、驗章＋金額都過了）
orders.status  = 'pending_payment' （訂單沒跟上）
```

後果：客人已付款、卻看到「待付款」、沒收到確認信（ops-runbook §1.1 第④類）。

**② 為什麼主臂救不到 —— 候選鍵不相交**

主臂候選鍵是 `payment.status='pending'`，但這種卡單的 payment **已是 `paid`**，主臂那條 `.eq("status","pending")` 永遠選不到。漂移臂用 inner embed 專撈這一格：

```
.eq("status", "paid")
.eq("orders.status", "pending_payment")   // orders!inner(status)
```

**③ 為什麼不打綠界 —— 信任財務事實**

主臂要打綠界，是因 payment 還 `pending`、系統尚未確認錢收到。漂移臂面對的 payment **已是 `paid`**——這個 `paid` 是 webhook 當初 **CheckMacValue 驗章通過＋金額白名單核對通過**後才寫入的財務事實，`gateway_trade_no` / `raw_callback` 都已落地。既然錢確定收到，唯一沒做完的只是「訂單狀態跟上」——不需再問綠界。

> **附帶好處**：漂移臂因此**不受綠界限流影響**。主迴圈被 `RateLimitError` / `QueryTradeInfoHttpError` `break` 中斷時，漂移臂在主迴圈之後照跑。

**④ 冪等推進＋清 sibling pending**

```
① ensureOrderPaid(source="reconcile-drift")  // 走 CAS + transition RPC，冪等
② markPendingPaymentsFailed(order_id)         // 清同單其餘 pending 殘留
③ ensureNotificationSent                       // 補寄確認信（卡單期間一定沒寄過）
```

- **① 冪等**：條件式 CAS 推進；webhook 遲到的重送若剛好也推進成功，這裡回 `already-settled`、不重複計 `driftPromoted`。撞到 `closed`（訂單已取消/退款）→ 走 `recordClosedOrder` P0 告警轉人工，不硬推。
- **② 清 sibling**：客人卡單期間可能重試付款、產生多張 pending payment（T74）；訂單推進成 paid 後把殘留 pending 標 failed，否則它們會一直卡在主臂候選集被反覆撈。
- **③ 補信**：卡單當下訂單還不是 paid，確認信必然沒寄過；`ensureNotificationSent` 內部自行判斷付款已成立才寄。

**⑤ 為什麼「無冷卻、天然收斂」**

主臂有 20h 冷卻閘門避免重複告警；漂移臂**刻意不套**，理由有二：
1. **推進成功即離開候選集**：一旦推成 paid，`orders.status` 不再是 `pending_payment`，下輪自然選不到——靠狀態轉移天然收斂，不需冷卻去重。
2. **共用主臂冷卻反而有害**：主臂處理該 payment（當時還 pending）時會蓋 `last_reconciled_at`；若漂移臂也認這個章，等它稍後翻 paid 變漂移單時反被冷卻排除、延後一天自癒。

**⑥ 踩過真實 bug 的細節：NULL-tolerant 年齡閘門**

年齡閘門用 `nullOrBefore("paid_at", cutoff)` 而**不是** `.lt("paid_at", cutoff)`。因 PostgREST 裡 `NULL < ts` 為假，直接 `.lt` 會**永久靜默排除 `paid_at IS NULL` 的列**。而 ops-runbook §1 步驟 3 的人工修復 SQL（`UPDATE payment SET status='paid', gateway_trade_no=...`）不寫 `paid_at`，正會產生這種列——加上取消守衛擋住逾期取消，這種單會**永遠卡 pending_payment 不自癒**，正是漂移臂要關掉的盲點。排序另加 `nullsFirst: true` 把人工列排最前，避免 backlog 超上限時被截掉。

> 安全性：程式寫入的 paid 列一律同時寫 `paid_at`，故 `paid_at IS NULL ⟹ 人工列 ⟹ 立即處理`；非 NULL 分支才壓 `MIN_AGE_MS`（10min），避免撈到 webhook 正 settle 中、payment 剛翻但訂單推進 in-flight 的單。

**⑦ Backlog 與 fail-visible**

- 上限 `DRIFT_LIMIT=20`，多撈一筆（`limit(21)`）精準偵測截斷；> 20 → `driftTruncated`＋warning。
- 候選查詢回 `{error}` → 回 `false` → 整支 cron 回 HTTP 500。漂移臂是 webhook 側卡單的**指定自癒者**，它 dead 掉必須讓監控看到紅燈。

**一句話**：漂移臂補的是「webhook 只做了一半」的洞——錢那半已成事實，缺的只是訂單狀態；它信任財務事實、不重問綠界、靠狀態轉移天然收斂，每次出手（`promoted webhook-side stuck order` 告警）都同時是一次 webhook 可靠度的計量。

### B.4 稽核臂（只偵測，durable 復發偵測）

- **候選鍵（兩次，參數化）**：`payment='paid'` ∧ `orders ∈ {cancelled, refunded}`，上限 20。
- **撈的是**：主臂／漂移臂的鍵都撈不到的殘餘——「錢收在已關閉訂單上」。
  - `cancelled` 成因：取消守衛 TOCTOU 窄窗 / T127 前既有列。
  - `refunded` 成因：Admin Override 逃生口不翻 payment / legacy 半套。
- **只偵測、不自動修**：每日查得到就發 error 告警（`paid payment on cancelled/refunded order`），是「還沒處理」的每日催辦，不靠事件當下的單次訊號；直到人工裁決（退款或恢復訂單，ops-runbook §6.1）才停。

### B.5 同支 cron 的輔助 sweep（非付款對帳，共用 fail-visible）

- **failed-notification sweep**：掃 `notification.status='failed'` 逐筆補寄（sendOnce 去重；訂單已取消/退款不寄）。
- **uninvoiced sweep**：掃 `paid ∧ invoice_status='none'` 補開電子發票（`issueInvoiceForOrder` 冪等）。

兩者皆冪等、即使主迴圈被綠界限流 `break` 也照跑（發票 API 是獨立網域與額度）。

---

> **相關任務**：T41（驗價）· T53（冪等）· T66（逾期取消）· T74（重試換 trade no）· T75（付款成功才清車）· T88（通知重試）· T89（主動對帳）· T92（狀態機守衛）· T107（推進順序 F-014）· T110（狀態轉換交易化）· T127（漂移臂＋取消守衛下沉）· T47（記錄式退款）· T126（對帳改小時級，未做）。
