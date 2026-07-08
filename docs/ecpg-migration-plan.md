# ecpg-migration-plan.md — 以站內付 2.0 取代 AIO 導轉式信用卡

> 文件更新日期：2026-07-08
> 用途：G-09（`docs/ecpay-blueprint/`）落地應用規劃——以 ECPG 站內付 2.0（AES-JSON 嵌入式）取代現行 AIO 導轉式信用卡（AioCheckOut/V5，CMV-SHA256）。含執行方案、影響範圍、測試規劃與 Pass Criteria。
> 狀態：📋 規劃階段，未定案、未實作。屬金流重大變更，動工前依 CLAUDE.md §7 先進 plan mode 取得確認。
> 依據：`docs/ecpay-blueprint/`（02 能力矩陣、03-4 安全設計、04-1 付款流程、05-3 sandbox 規劃）＋現行程式碼盤點（`docs/architecture.md` §2.2）。

---

## 0. 方案選型與建議時機（先讀這段）

| 候選 | 說明 | 判定 |
|------|------|------|
| **站內付 2.0（ECPG）** | 嵌入式：卡號在特店頁面輸入、直送綠界（不經特店後端）；AES-JSON 雙網域 | ✅ 本文件的規劃對象 |
| 幕後授權（BackAuth） | 特店後端直接收送卡號 | ❌ 排除：PCI SAQ-D 等級，單人團隊不可承受 |
| 維持 AIO 導轉 | 現況 | 對照組（rollback 目標） |

**取代的效益**：客人不離站（高端品牌體驗一致）、為綁卡快付（`CreatePaymentWithCardID`，回頭客一鍵付款）與頁內 Apple Pay 鋪路。

**取代的成本（誠實列出）**：
1. 前端須依官方順序載入 **jQuery → node-forge → ECPay SDK**——對 React 19 專案是異質依賴，且 CSP `script-src 'self'` 必須放寬白名單綠界網域（T58 的安全姿態要重新審一次）。
2. **3D 驗證變成特店的責任**：AIO 時代 3D 對特店透明；ECPG 的 `CreatePayment` 回 `ThreeDInfo.ThreeDURL` 時必須導向，漏導向＝交易逾時失敗（官方註明 2025/8 起幾乎必現）。多出一種全新的失敗模式。
3. ECPG 的 ReturnURL **重送機制官方未說明**（AIO 的「5–15 分鐘×4 次」不必然適用）——T89 對帳 cron 從「兜底」升級為「不可或缺」。
4. 協議全換：CheckMacValue → AES-128-CBC 三層結構、雙層錯誤檢查（TransCode 外層＋RtnCode 內層）、**RtnCode 從字串變整數**、查詢／退款走 `ecpayment` 網域（打錯網域 404）。

**建議時機**：**MVP 上線（M4/T38）前不做**。現行 AIO 已通過 sandbox 實測、冪等鏈完整、風險已知；ECPG 的效益（綁卡、體驗）屬回頭客優化，在有真實流量前無法變現。已登記為 **T103**（2026-07-08，tasks.csv），依賴 T35（正式金鑰）、T82（環境分離）、T101（CI）完成後才動工。以下規劃按「屆時動工」撰寫。

---

## 1. 執行方案（五階段，每階段一個可獨立驗收的 PR 批次）

### Phase 0　前置與可行性驗證（0.5–1 天，不寫產品碼）

1. **合約確認**（使用者本人）：向綠界確認現有特店帳號可開通站內付 2.0；sandbox 用官方共用帳號 `3002607`（與 AIO 同帳號、同金鑰，協議改 AES-JSON）先行。
2. **CSP spike**：在丟棄式分支實測 SDK 三段載入所需的最小 CSP 白名單（`script-src`／`connect-src`／`frame-src` 需要哪些 `*.ecpay.com.tw` 網域），產出白名單清單交審。此為 go/no-go 關卡——若 SDK 需要 `unsafe-eval` 之類不可接受的放寬，方案中止。
3. **決策落檔**：`decisions.csv` 記錄選型結論與 CSP 白名單定案。

### Phase 1　協議層（1–1.5 天）

新增 `src/lib/ecpay/ecpg/`（與既有 AIO 模組平行，**不改動任何現有檔案**）：

| 檔案 | 職責 |
|------|------|
| `aes-payload.ts` | AES-128-CBC 加解密＋`aesUrlEncode`（僅 urlencode，空格→`+`、`~`→`%7E`；**與 CMV 的 encode 是兩套函式，禁止共用**）＋標準 Base64（禁 URL-safe） |
| `transport.ts` | 雙網域路由單一出處：Token 系列→`ecpg.ecpay.com.tw`、查詢/退款→`ecpayment.ecpay.com.tw`；呼叫端不允許自行組 URL（藍圖 04-1 §4 規則）；三層請求組裝（MerchantID＋RqHeader.Timestamp/Revision＋Data）與雙層回應檢查（TransCode==1 → 解密 → RtnCode==1 整數） |
| `env`（沿用 `env.server.ts`） | 新增 `ECPG_URL`、`ECPAYMENT_URL`（fail-fast；不從 `ECPAY_PAYMENT_URL` 推導——那是 AIO 的） |

驗收：單元測試（見 §3.1）全綠；sandbox 對打 `GetTokenbyTrade` 取得 RtnCode=1（含 ConsumerInfo 完整欄位——官方註明 Email/Phone 未填是最常見失敗根因）。

### Phase 2　後端付款流程（2–3 天）

| 項目 | 內容 |
|------|------|
| Token server action | `getPaymentToken(orderNo)`：查訂單（僅 `pending_payment`）→ 復用/預建 pending payment（**沿用既有 `merchant_trade_no` 機制與 T53 冪等，不另立格式**）→ `GetTokenbyTrade` → 回 Token 給前端 |
| `createEcpgPayment` action | 收前端 PayToken → `CreatePayment` → 分流：含 `ThreeDInfo.ThreeDURL` → 回給前端導向；不含 → 依回應處理 |
| 新 webhook `/api/ecpay/ecpg-notify` | **獨立於既有 `/api/ecpay/notify`**（AIO 續用至退場）：JSON POST → AES 解密 → RtnCode（整數）→ 金額核對 → 復用既有 `ensureOrderPaid`／`ensureNotificationSent`／`sendOnce`（這三支與協議無關，零改動） |
| 查詢切換 | `query-trade-info.ts` 旁新增 `ecpg-query-trade.ts`（`/1.0.0/Cashier/QueryTrade`）；reconcile cron 依 payment 記錄的協議別分流查詢（見 §2 資料層） |
| 結果導回 | ECPG OrderResultURL 是 Form POST 且 JSON 藏在 `ResultData` 欄位——新 route `/api/ecpay/ecpg-order-result`，維持「僅導向、不驅動狀態」原則與 303 redirect |

### Phase 3　前端嵌入頁（1.5–2 天）

- `/checkout/pay` 依 feature flag 分流：`PAYMENT_FLOW=aio`（現行）｜`ecpg`（新）。
- ECPG 版：SDK 三段載入、容器 ID 固定 `ECPayPayment`、卡號輸入（直送綠界）、PayToken 回傳後端、`ThreeDURL` 全視窗導向（**不可 iframe**）。
- 結果頁 `/checkout/success` 的輪詢機制（T27）**原樣沿用**——3D 完成後 webhook 與導回無固定先後，現有的「pending_payment 輪詢 3s×90s」設計正好覆蓋。

### Phase 4　帳務配套（0.5–1 天）

- 退款：`/1.0.0/Credit/DoAction` 客戶端模組（**sandbox 不可測**，僅寫實作＋單測，正式環境小額實測，見 §3.4）。
- 對帳 cron：候選查詢不變，逐筆依協議別走對應 Query API；`RateLimitError` 語意沿用。

### Phase 5　灰度切換與退場（跨 1–2 週觀察期）

1. staging（preview）先全量 ECPG，跑完 §3 全部測試。
2. production 以 feature flag 切換——**不做百分比灰度**（單人店、流量小，flag 全開/全關即可），但**保留 AIO 路徑程式碼與 webhook 至少 30 天**：切換前建立的 pending 訂單，其重送通知仍會打舊 webhook。
3. Rollback 條件（任一命中即切回 `aio`，5 分鐘內完成）：付款成功率較 AIO 基線下降、3D 導向失敗成為常態、webhook 遲滯造成 reconcile promoted 告警連續出現。
4. 觀察期滿、且最後一筆 AIO pending payment 已終結（paid/failed/逾期），才移除 AIO 信用卡路徑（AIO 建單能力保留——未來 ATM/超商等付款方式仍可能走 AIO）。

---

## 2. 影響範圍

### 2.1 程式碼

| 層 | 影響 | 幅度 |
|----|------|------|
| `src/lib/ecpay/` | 新增 `ecpg/` 子模組（協議、傳輸、查詢、退款）；既有 `check-mac-value.ts`／`aio-payment.ts`／`merchant-trade-no.ts` **零改動**（merchant-trade-no 沿用，G-01 的 parse 單一出處先做完） | 新增 ~5 檔 |
| `src/app/api/ecpay/` | 新增 `ecpg-notify`／`ecpg-order-result` 兩個 route；既有兩個 route 不動、留至退場 | 新增 2 route |
| `src/app/checkout/pay/` | feature flag 分流＋ECPG 嵌入頁（client component 載 SDK） | 中改 |
| `src/lib/order/`、`src/lib/notification/` | **零改動**——狀態機、`ensure-paid`、`sendOnce` 與協議無關，這正是現行模組邊界的紅利 | 無 |
| `next.config.ts` | CSP 放寬：`script-src`／`connect-src`／`form-action` 加綠界白名單（Phase 0 定案清單） | 小改、需安全審查 |
| reconcile cron | 依協議別分流查詢 | 小改 |

### 2.2 資料層（1 支 migration）

- `payment` 表**新增** `protocol text not null default 'aio'`（值：`aio`｜`ecpg`）——reconcile 分流與退場判斷的依據。只增欄不改既有欄，符合「已套用 migration 不可改」原則。
- `merchant_trade_no`、`uq_payment_one_paid_per_order`、`raw_callback`（改存解密後 JSON）全部沿用，**冪等鍵不變**。

### 2.3 環境變數（使用者本人設定）

新增：`ECPG_URL`、`ECPAYMENT_URL`、`PAYMENT_FLOW`（flag）。沿用：`ECPAY_MERCHANT_ID`／`HASH_KEY`／`HASH_IV`（sandbox 同一組；正式環境依綠界開通結果，可能另發）。前置依賴：**T82 環境分離必須先完成**——灰度切換需要 staging 與 production 的 flag 各自獨立。

### 2.4 不受影響（明確劃界）

購物車／驗價（T41）／建單（T23）／訂單狀態機／Email 通知鏈／售後／後台——金流協議在 `payment` 這層被完全封裝，訂單層看不到差異。

### 2.5 風險登記

| 風險 | 等級 | 緩解 |
|------|------|------|
| ECPG webhook 重送規則官方未說明 | 🔴 | reconcile cron 升為主要防線：切換初期把 cron 從每日一次加密到每 4 小時（`vercel.json` 一行），穩定後降回 |
| 3D 導向漏接（新失敗模式） | 🟠 | E2E 必測案例（§3.3 E-04）；`ThreeDURL` 存在但前端未導向的路徑要有 Sentry 告警 |
| CSP 放寬擴大攻擊面 | 🟠 | Phase 0 白名單最小化；上線前 securityheaders.com 重掃 |
| jQuery 與 React 的 DOM 所有權衝突 | 🟡 | SDK 容器放在 React 樹外圍固定節點、不做 re-render；spike 階段驗證 |
| sandbox 為公開共用帳號 | 🟡 | MerchantTradeNo 前綴隔離；測試不帶真實 Email |

---

## 3. 測試規劃

分四層，對齊藍圖 `05-testing/`。標 ⚠ 者受 sandbox 限制、需正式環境補驗。

### 3.1 Unit（vitest，CI 必跑）

| # | 案例 |
|---|------|
| U-01 | AES 加密→解密 round-trip；`aesUrlEncode` 空格→`+`、`~`→`%7E`；確認**未**套用 CMV 的轉小寫與 .NET 還原表 |
| U-02 | Base64 標準 alphabet 檢查（含 `+/=` 的密文不得被轉成 `-_`） |
| U-03 | 雙層檢查矩陣：TransCode≠1／TransCode=1+RtnCode≠1／解密失敗／`RtnCode` 為字串 `"1"`（整數契約，字串必須判失敗）四種都走到錯誤路徑 |
| U-04 | `transport.ts` 網域路由：Token 系列組出 ecpg、查詢/退款組出 ecpayment；未知 API 名 throw（防打錯網域 404 被誤判） |
| U-05 | ecpg-notify 冪等：同一通知重放 N 次只推進一次（複用既有 notify 測試的 mock 架構） |
| U-06 | 金額核對：TradeAmt 與 payment.amount 不符→拒絕；`Number()` 轉型與 `Number.isFinite` 防呆（沿用現行寫法） |
| U-07 | reconcile 分流：`protocol='aio'` 走舊查詢、`'ecpg'` 走新查詢，互不誤打 |

### 3.2 Integration（mock ECPG server）

| # | 案例 |
|---|------|
| I-01 | GetTokenbyTrade：ConsumerInfo 缺 Email/Phone → 正確解讀 RtnCode≠1 並回使用者可讀錯誤 |
| I-02 | CreatePayment 回 `ThreeDInfo.ThreeDURL`（巢狀）→ action 正確取出並回傳前端 |
| I-03 | CreatePayment 逾時／HTTP 5xx → payment 停留 pending、不誤標 failed（留給 webhook／reconcile 收斂） |
| I-04 | webhook 與 reconcile 競態：CAS 守衛下兩路徑並發只有一方 promoted（沿用既有測試模式） |

### 3.3 E2E（sandbox `3002607`＋tunnel 收回呼）

| # | 案例 | 判準 |
|---|------|------|
| E-01 | 測試卡 `4311-9522-2222-2222` 一次付清全流程（含 3D，驗證碼固定 `1234`） | orders→paid、payment→paid、兩封信各一、status_log 一筆 |
| E-02 | 3D 頁面按取消／關閉 | 訂單留 pending_payment；重新進 pay 頁可再付（trade no 依 T53 規則） |
| E-03 | webhook 先到、導回後到（及反序） | 結果頁輪詢兩種順序都收斂到成功畫面 |
| E-04 | **人為不導向 ThreeDURL**（模擬前端 bug） | 交易逾時後訂單不卡死：reconcile 查得 TradeStatus 並告警，Sentry 有 3D 未導向事件 |
| E-05 | webhook 重放（手動重送同 payload） | 冪等：無重複信件、無重複 status_log |
| E-06 | 篡改通知（改金額後重簽不possible→解密失敗；直接改密文） | 拒絕、Sentry 告警、狀態不變 |
| E-07 | reconcile cron 對 ECPG pending 的 promote 路徑（模擬 webhook 丟失：關掉 tunnel 再付款） | cron 於下輪把訂單救成 paid＋promoted 告警 |
| E-08 | AIO 回歸最小集（雙軌期間）：現行 AIO 信用卡全流程 | 與切換前行為完全一致 |

### 3.4 ⚠ 正式環境驗收（sandbox 不可測項）

| # | 案例 |
|---|------|
| P-01 | 真卡小額（最低可行金額）付款＋退刷 `DoAction R` 全流程（sandbox 無授權環境，退款只能在此驗） |
| P-02 | 撥款對帳檔下載解析（銀行上班日 14:00 後） |
| P-03 | securityheaders.com 重掃 staging＋production（CSP 放寬後） |
| P-04 | LINE／Facebook 內建 WebView 開啟付款頁 → 引導外開瀏覽器的動線有效 |

---

## 4. Pass Criteria（切換 production flag 的門檻，全部量化、缺一不可）

1. **測試全綠**：§3.1／3.2 進 CI 必跑且綠；§3.3 E-01～E-08 於 staging 全數通過並留存紀錄（work-log）。
2. **冪等零破口**：E-05 重放 10 次，DB 中 payment paid 記錄、notification 記錄、order_status_log 各恰好 1 筆。
3. **金額紅線**：E-06 全部拒絕；程式碼審查確認 ECPG 路徑的金額來源 100% 是 DB `payment.amount`／`orders.total_amount`，無任何取自回呼即信任的路徑。
4. **救援路徑實證**：E-07 中 webhook 丟失的訂單在下一輪 cron 內自動收斂為 paid，且 Sentry 收到 promoted 告警。
5. **安全姿態不退步**：P-03 掃描等級不低於切換前基線；CSP 白名單與 Phase 0 定案清單完全一致（無「順手多開」）。
6. **回滾演練完成**：staging 實際演練 flag `ecpg→aio` 切回，切回後 AIO 全流程（E-08）立即可用，全程 ≤5 分鐘。
7. **正式環境金流閉環**：P-01 真卡付款＋退刷成功，金額分毫不差入帳（對 P-02 撥款檔）。
8. **文件同步**：`architecture.md` §2.2／§5、`ops-runbook.md`（ECPG 異常的人工救援段落）、`coding-system.md`（若過程發現新 bug 類型）更新完畢。

**退場（移除 AIO 信用卡路徑）的獨立門檻**：production 切換滿 30 天、期間 rollback 條件零觸發、且最後一筆 `protocol='aio'` 的 pending payment 已終結。
