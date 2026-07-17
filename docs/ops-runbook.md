# ops-runbook.md — 人工救援 Runbook（T90，v1）

> 文件更新日期：2026-07-15
> 用途：程式中多處已知失敗情境的設計答案是「留給人工修」——本檔寫清楚「人工修」具體怎麼做。「留給人工」而沒有 runbook＝留給恐慌。
> 讀者：店家本人（單人營運）。操作介面：Supabase Dashboard（SQL Editor）、Vercel Dashboard（Logs／Cron）、綠界廠商後台、Sentry、本站 `/admin/orders`。
> 維護原則：每次新增「已知失敗情境」（新任務、新審查發現）就補一節；T47（退刷 API）落地後同步更新對應章節（T88 已落地並同步於 §4）。
> ⚠️ **執行紀律**：任何修復 SQL 前，先跑對應的「診斷查詢」確認現況；能走 `/admin/orders` 後台操作（會寫 `order_status_log` 稽核）就不要裸改 SQL；**帳務表（orders／payment／order_item／order_status_log）永遠禁 DELETE**。

---

## 0. 通用診斷入口

任何「訂單怪怪的」都先跑這兩條（Supabase SQL Editor）：

```sql
-- 一張訂單的全貌：訂單＋付款嘗試＋通知＋狀態史
select o.order_no, o.status as order_status, o.total_amount, o.created_at,
       p.merchant_trade_no, p.status as payment_status, p.gateway_trade_no, p.last_reconciled_at
from orders o left join payment p on p.order_id = o.id
where o.order_no = 'INC-XXXXXXXX-XXXXXX';

select type, status, created_at from notification
where order_id = (select id from orders where order_no = 'INC-XXXXXXXX-XXXXXX');

select from_status, to_status, is_override, note, created_at from order_status_log
where order_id = (select id from orders where order_no = 'INC-XXXXXXXX-XXXXXX')
order by created_at;
```

輔助資訊來源：

| 來源            | 看什麼                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------- |
| Sentry          | webhook／對帳／寄信的例外事件（notify、send-once、reconcile 的靜默失敗點都已接 Sentry，T37） |
| Vercel Logs     | function 即時輸出（留存短，發生當下盡快看）；Cron 執行紀錄                                   |
| 綠界廠商後台    | 交易的**權威狀態**（是否已收款、TradeNo、金額）；退刷操作入口                                |
| `/admin/orders` | 訂單狀態、Admin Override（會寫稽核 log）                                                     |

---

## 1. 訂單卡 `pending_payment`，客人聲稱已付款

**成因**：webhook 遺失／驗章失敗／處理中例外；前端 redirect 那條本來就可能斷。

**判斷**：

1. 跑 §0 查詢：`payment.status` 是否仍 `pending`？
   - **分支**：若 `payment.status` 已是 `paid`、但 `orders.status` 仍 `pending_payment`——這是**webhook 側卡單**（webhook 先翻 payment paid、`settlePaid` 推進訂單那步失敗，且 ECPay 重送已耗盡）。T127 已落地：對帳 cron 的**漂移臂**（第二候選臂，撈 payment=paid＋orders=pending_payment）會在**隔日凌晨冪等推進**並補寄確認信（Sentry 會有「reconcile: promoted webhook-side stuck order」warning），T66 逾期取消 cron 也會 skip 這種訂單（「paid payment exists on expiring order」error 告警）——先等自癒，**連續兩天仍漂移才人工**：到 `/admin/orders/[id]` 用 **Admin Override** 手動把訂單推進到 `paid`（reason 填「webhook settlePaid 失敗，payment 已收款、人工推進訂單」），再依 §4 補確認信。**急件請直接走 Admin Override**——不要指望「手動觸發對帳」加速：漂移臂逐筆先蓋 `last_reconciled_at`（stamp-first）＋候選查詢帶 20h 冷卻，當晚排程已處理過的漂移列，同日手動重跑對帳會撈不到它（`driftChecked=0` 不代表沒漂移，只代表冷卻期內）。
2. 到**綠界廠商後台**用 `merchant_trade_no` 查該筆交易——綠界顯示「已付款」才算已付款（權威來源）。

**修復（依序嘗試，前面的成功就停）**：

1. **等對帳兜底（首選）**：T89 每日對帳（Vercel Cron，18:00 UTC＝台北 02:00）會撈 pending payment 主動查綠界並冪等修正。不急的話等下一輪即可。
2. **手動觸發對帳**：Vercel Dashboard → Cron → 手動 Run `/api/cron/ecpay-reconcile`（或依該 route 的驗證方式帶密鑰打一次）。
3. **仍未修正才手動改**（代表對帳也查不到或有 bug，先看 Sentry）：
   ```sql
   -- 先確認綠界後台已收款、金額一致，再執行；一次一單
   update payment set status = 'paid', gateway_trade_no = '<綠界TradeNo>'
   where merchant_trade_no = '<19碼tradeno>' and status = 'pending';
   ```
   接著到 `/admin/orders/[id]` 用 **Admin Override** 把訂單改為 `paid`（reason 填「webhook 遺失，依綠界後台交易 <TradeNo> 人工對帳」）——用後台而非 SQL，稽核 log 才完整。
4. 確認信未寄的話 → 見 §4。

> ℹ️ **T107 之後的正常漂移態**：自動對帳的推進順序是「先 orders、payment 翻 paid 留最後」（失敗時保留候選鍵供隔日重試），故可能短暫看到「`orders.status='paid'` 但 `payment.status='pending'`」——這是自癒中（隔日 cron 的 CAS 會補翻），**勿**誤判成異常手動改。連續兩天以上仍漂移才依上述步驟處理。本節 §8 的「先 payment 再 orders」是**人工修復**的權威同步順序，與自動對帳的重試鍵保留是兩回事，不衝突。

### 1.1 對帳各失敗點的實際體驗與自癒時間（T107 使用者體驗矩陣）

> 前提都是 webhook 已先失靈（否則輪不到對帳出手）、客人在綠界**已成功扣款**。對帳 cron 現行每日一次（台北 02:00）；T126（改小時級）落地後本表的「隔日／每日」同步更新。

| 失敗點                                     | 客人看到什麼                                                 | 店家看到什麼                                                                                                                                                                                              | 自癒時間                                                                      |
| ------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| ① 訂單推進失敗（DB 暫時錯誤）              | 付了款但訂單仍「待付款」、沒收到確認信                       | Sentry exception ＋ cron summary `unexpected` +1                                                                                                                                                          | 隔日 cron 冪等重試（連續多日同一筆才走本節上方步驟）                          |
| ② payment 翻 paid 失敗                     | **幾乎無感**——訂單已顯示已付款、確認信照寄（③不被②擋）       | 訂單 paid／payment pending 漂移（見上方註記，勿手動改）；唯一風險窗口：漂移期間要退款的話，`gateway_trade_no` 尚未落地——去綠界後台用 `merchant_trade_no` 查（§3 同一條路）                                | 隔日 cron CAS 補翻                                                            |
| ③ 確認信寄送失敗                           | 訂單狀態、金額都正常，只是**信晚到**；急的客人可在訂單頁自查 | `notifyFailed` 告警；連續 2–3 天同一筆 → §4 人工介入                                                                                                                                                      | 每日 sweep 補寄                                                               |
| ④ webhook 側卡單（見下方）                 | 付了款但訂單仍「待付款」、沒收到確認信                       | `payment.status='paid'` 但 `orders.status='pending_payment'`；Sentry warning「promoted webhook-side stuck order」＋summary `driftPromoted`（自癒當下發）；卡單期間若逼近 72h，另有逾期 cron 被取消守衛擋下的 error 告警「paid payment exists on expiring order」 | 隔日 cron 漂移臂冪等推進（T127；連續兩天仍漂移才走 §1 判斷步驟 1 的分支人工） |
| ⑤ 訂單已關閉仍收到錢（逾期取消後付款成立） | 訂單顯示已取消，但卡已被扣款                                 | error 告警「reconcile: money received on closed order」＋summary `promotedOnClosedOrder`；payment 已翻 paid、訂單維持 cancelled／refunded。**此狀態另有每日 recurring 稽核臂復發偵測**（見下方 ⑥）                                                     | **不自癒**——人工裁決退款或恢復訂單（§6.1）                                    |
| ⑥ 錢收在已取消訂單上（durable 稽核）       | 同⑤（訂單已取消、卡已扣款）                                 | 每日對帳 recurring 稽核臂（鍵 `payment=paid ∧ orders=cancelled`）error 告警「reconcile: paid payment on cancelled order」＋summary `paidOnCancelled`——**主臂／漂移臂都撈不到這種列**，這支是它的 durable 兜底（不靠取消當下的單次告警）                | **不自癒**——人工裁決（§6.1），但每日重複偵測直到處理                          |

> ℹ️ **第④類「webhook 側卡單」的成因與自癒（T127 已落地）**：webhook 端 `settlePaid` 先翻 `payment.status='paid'`、才推進訂單，若推進那步失敗且 ECPay 重送額度耗盡，會停在「payment 已 paid、orders 卡 pending_payment」。主對帳臂的候選鍵是 `payment.status='pending'`，撈不到這種漂移；T127 的**漂移臂**（第二候選臂，撈 payment=paid＋orders=pending_payment，不打 ECPay——payment=paid 是驗章＋金額核對通過後的財務事實，直接信任）隔日冪等推進＋補寄確認信。**取消守衛**（有 paid payment 就不准取消）下沉在共用的 `transitionOrder`，因此**所有**取消路徑（逾期 cron、結帳改單、admin 手動取消）都擋得住，不再只有逾期 cron；被擋下時逾期 cron 記 `paidConflict`＋error 告警。連續兩天以上仍漂移才依 §1 判斷步驟 1 的分支人工處理。

修完 T107＋T127 後，自動兜底涵蓋的失敗點（①②③④）都會自癒；剩餘需人工的狀況有三類：**設計上的一天延遲**（webhook 失靈當天，客人最壞等到隔天凌晨才被扶正——急件走 Admin Override）；**「錢收在已取消訂單上」（`payment=paid`／`orders=cancelled`）**——取消守衛的 TOCTOU 毫秒窄窗、或 T127 部署前既有列都可能產生這種狀態，主對帳臂（候選鍵 `payment=pending`）與漂移臂（候選鍵 `orders=pending_payment`）**都撈不到**，改由每日 **recurring 稽核臂**（鍵 `payment=paid ∧ orders=cancelled`，summary `paidOnCancelled`）durable 復發偵測、每日告警直到人工處理（上表第⑥類、§6.1）——不再依賴取消當下的單次告警，也不再需要一次性人工巡檢；和**本來就該人工裁決的錢務問題**——金額不符（§2，永不自動修）、email 永久錯誤（§4）、重複扣款／退款（§5／§6）、已關閉訂單收到錢（第⑤／⑥類，§6.1）、付款失敗後重試付款（T66/T74 生命週期範圍，尚未做）。

### 1.2 webhook 失敗的分層機率評估（2026-07-15，工程推估）

> webhook＝綠界伺服器主動 POST `/api/ecpay/notify`，沒收到 `1|OK` 就重送數次。以下是量級推估（非實測）；**上線後的實測機制就是 Sentry 的 `promoted stuck payment` 告警**——對帳出手一次＝webhook 漏接一次，每月超過 1–2 次即異常、優先查第 4 層。

| 層                                 | 單次失敗率                                        | 綠界重送能救嗎                          | 最終漏接機率（重送後仍失敗）                             |
| ---------------------------------- | ------------------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| 1. 網路暫時故障（綠界→Vercel）     | ~0.01–0.1%                                        | ✅ 幾乎必救（重送分散在不同時間點）     | 接近 0（<百萬分之一）                                    |
| 2. Vercel 平台事故                 | 年停機約 1–4 小時（≈99.95%+ 可用性）              | ⚠️ 看事故長度——重送窗口撐不過長時間停機 | ~0.01–0.05%（付款剛好落在長事故內）                      |
| 3. 應用層（DB 暫時錯誤、bug）      | Supabase 暫時錯誤 ~0.01–0.1%/請求                 | ✅ route 回 ERR 觸發重送，多數自癒      | 接近 0；持續性 bug 例外——靠測試＋review 壓，無法用數字估 |
| 4. 設定錯誤（ReturnURL、金鑰混用） | 不是機率、是**事件**：每次動設定約 5–20% 人為出錯 | ❌ 全滅型（每筆都收不到）、不自癒       | 一筆真實測試交易可 100% 驗出（T35 驗收必做）             |

白話結論：設定正確的前提下，單筆訂單「webhook 徹底失靈、要靠對帳搶救」的量級約 **0.01–0.1%**（主要由平台長事故貢獻）；以 MVP 單量推算，對帳真正出手約幾個月到幾年一次——每日兜底在數學上足夠，T126（小時級）買的是罕見事件發生時的體驗上限（一天→一小時），不是機率改善。**風險大頭在第 4 層**，集中在 T35 換正式網域＋金鑰、以及之後任何動綠界後台設定的時刻——唯一預防手段是改完立刻打一筆真實小額交易驗證 webhook 到達。

**風險**：綠界後台沒有這筆＝客人可能付到別單或根本沒付成——**不可**只憑客人截圖改狀態。

---

## 2. 金額不符告警（webhook TradeAmt ≠ 系統金額）

**成因**：理論上不應發生（金額由伺服器端白名單重算）。出現＝有人竄改回拋、或建單/付款鏈有 bug。

**判斷**：Sentry 事件或 Vercel logs 裡的金額核對錯誤；比對 `orders.total_amount`、綠界後台實收金額、`payment.raw_callback` 內的 `TradeAmt`。

**處置**：

- webhook 端已設計為**拒絕處理**（不會用錯誤金額記帳），訂單會停在 `pending_payment`。
- 綠界實收 ≠ 訂單金額：**不要**把訂單標 paid。聯絡綠界確認交易，多收退刷、少收請客人補刷（換新 trade no 重新付款）。
- 這是 P0 訊號：當日開 bug 調查（走 `docs/coding-system.md` §3.5 三問），不可只人工消化告警。

---

## 3. `payment.status='paid'` 但缺 `gateway_trade_no`

**成因**：舊資料或回拋解析異常。影響：日後退刷、對帳單比對找不到綠界交易號。

**修復**：綠界後台以 `merchant_trade_no` 查到 TradeNo 後回填：

```sql
update payment set gateway_trade_no = '<綠界TradeNo>'
where merchant_trade_no = '<19碼tradeno>' and gateway_trade_no is null;
```

---

## 4. 通知信卡 `failed`／客人沒收到信（T88 已落地自動重試）

**現行機制（T88，PR #66）**：寄信失敗時 `notification.status='failed'`，系統有兩層自動補救——

1. **快路徑**：webhook 對 ECPay 回 `0|notification delivery failed` 觸發重送，重送時 reclaim 補寄（限 ECPay 重送額度內）。
2. **兜底**：每日 reconcile cron 的 failed-notification sweep 掃 `status='failed'` 逐筆補寄（訂單已取消／退款不寄）。暫時性故障（Resend 抖動）最慢隔天自癒，**不需人工介入**。

**何時該人工介入**：Sentry 的 `reconcile: notification still failing` 告警**連續 2–3 天出現同一筆 orderId+type**——暫時性故障不會連續失敗三天，基本可斷定是永久性問題（客人 email 打錯、硬退信、T35 前 `onboarding@resend.dev` 只能寄到 Resend 帳號本人信箱的限制）。

**判斷**：

```sql
select n.type, n.status, n.created_at, o.order_no, o.status as order_status
from notification n
join orders o on o.id = n.order_id
where n.status = 'failed' order by n.created_at desc;
```

並到 Sentry 看該筆的錯誤內容（Resend 回的 error message 會寫明退信原因）。

**修復（確認為永久性失敗後）**：

1. 到 [Resend Dashboard](https://resend.com) 確認退信原因；若是 email 打錯，聯絡客人（訂單有電話）核對。
2. 手動補寄：用正確 email 從 Resend 後台或以一般信箱寄出（訂單資訊照 `/admin/orders/[id]` 抄）。
3. 補寄後把該列標記 `sent`，讓每日 sweep 停止重試、告警停止：
   ```sql
   update notification set status = 'sent', sent_at = now() where id = '<該列id>' and status = 'failed';
   ```
4. 大量 `failed` 同時出現 → 檢查 `RESEND_API_KEY` 有效性與 Resend 帳號額度；上線前另注意 T35（FROM 網域驗證）是否已完成。

> 失敗分類（暫時／永久）與嘗試次數上限的完整自動化需加欄位，登記於 T123 技術債，營運後視告警噪音決定是否做。

---

## 5. 疑似重複扣款（客人刷了兩次）

**成因**：設計上冪等鎖（每單最多一筆 paid＋條件式 UPDATE）應擋掉系統面重複；仍可能發生「同一單兩個 merchant_trade_no 都在綠界成功」（第一次其實成功但客人重試）。

**判斷**：

```sql
select merchant_trade_no, status, gateway_trade_no, created_at from payment
where order_id = (select id from orders where order_no = 'INC-...') order by created_at;
```

兩筆以上都在**綠界後台**顯示已收款 → 確認重複扣款。

**處置**：保留最早成功那筆；其餘到綠界後台**退刷**（全額）。系統內把被退的 payment 標 `refunded`（訂單本身維持 `paid`，因為有效付款仍存在）：

```sql
update payment set status = 'refunded' where merchant_trade_no = '<被退那筆>' and status = 'paid';
```

⚠️ 若此 UPDATE 被 partial unique index 擋下（理論上不會，`refunded` 不在 paid 索引內），停下來查 schema，不要硬改。主動 email 告知客人退刷已處理（3–7 個工作天入帳）。

---

## 6. 退款（過渡期流程，T47 自動化前）

1. 售後申請確認要退款（`/admin/orders/[id]` 售後區塊）。
2. **綠界廠商後台**對該筆交易操作退刷（信用卡）；記下退刷結果。
3. `/admin/orders/[id]` → Admin Override → `refunded`（reason 寫明退刷單據／日期）。
4. payment 對應列標 `refunded`（同 §5 SQL）。
5. ⚖️ 已開電子發票（T42 之後）須折讓／作廢——會計流程未定案前，先記錄在訂單 note，發票開立後不可略過此步。
6. 目前**沒有退款通知信**（T87 未做）——人工 email 告知客人。

### 6.1 錢收在已關閉／已取消訂單上（人工裁決）

**觸發本節的三個 Sentry 訊號**（成因不同，裁決流程相同）：

| Sentry 訊息                                                              | summary 計數           | 成因                                                                                                                                   | 復發偵測             |
| ------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `reconcile: money received on closed order`                              | `promotedOnClosedOrder` | 對帳（主臂或漂移臂）向綠界／依財務事實推進時，重查發現訂單已 cancelled／refunded                                                        | 單次（payment 已 paid，隔日不再入選） |
| `transitionOrder: money received on order cancelled during transition`   | —                       | 取消守衛的 TOCTOU 毫秒窄窗：pre-guard 查無 paid、CAS 取消 commit 後才查到 payment 已 paid                                              | 單次（取消當下發）   |
| `reconcile: paid payment on cancelled order`                             | `paidOnCancelled`       | **durable 稽核臂**：每日掃 `payment=paid ∧ orders=cancelled`——上面兩種單次訊號漏看、或 T127 部署前既有列，都會被這支每日重新撈到告警 | **每日重複**直到處理 |

**成因總述**：逾期自動取消／人工取消後客人才完成付款，或取消與 webhook 結算的窄窗競態。payment 照翻／維持 `paid`（`gateway_trade_no`／`raw_callback` 已落地＝日後退款的依據），訂單維持 cancelled／refunded。**不自癒**——錢收了但訂單不會自動復活，必須人工裁決。

**判斷**：跑 §0 查詢確認 `orders.status`（cancelled／refunded）＋`payment.status='paid'`；到綠界後台核對實收金額與 TradeNo。

**裁決（二選一，先聯絡客人確認意願）**：

1. **退款**：綠界後台對該筆交易退刷（操作同 §5），完成後 payment 標 `refunded`（同 §5 SQL）；人工 email 告知客人（3–7 個工作天入帳）。
2. **恢復訂單**：客人仍要商品且交期可接受 → `/admin/orders/[id]` Admin Override 把訂單改 `paid`（reason 寫明「取消後付款成立，經客人確認恢復訂單」），再依 §4 補寄確認信。

⚠️ 前兩個訊號是**單次**的——收到當日就要處理，別等第二封。第三個（`paid payment on cancelled order`）是 durable 兜底，會**每日重複告警**直到你把該列裁決掉（退款標 `refunded`、或恢復訂單改 `paid`），是「還沒處理」的每日催辦，不是新事件。

---

## 7. 對帳 Cron 失敗／從未執行

**判斷**：Vercel Dashboard → Cron 執行紀錄；Sentry 是否有 reconcile 例外；抽查：

```sql
select count(*) from payment where status = 'pending'
and created_at < now() - interval '2 days' and last_reconciled_at is null;
```

筆數持續增加＝對帳沒在跑或一直失敗。

**處置**：看 Vercel Cron 是否啟用（`vercel.json` crons 需 production 部署後生效）、route 是否回 200；ECPay 查詢 API 被限流（403）時 route 有退避，隔日自然重試。連續多日失敗 → 開 bug。

---

## 8. 修復順序與紅線（總則）

1. **權威順序**：綠界後台 ＞ `payment` ＞ `orders` ＞ 通知信。修復永遠從權威端往下游同步，不反向。
2. **先 payment、再 orders、最後補通知**；orders 狀態變更優先走 `/admin/orders` Admin Override（寫稽核 log），SQL 直改 orders.status 是最後手段（會缺 log，事後補記到訂單 note）。
3. **禁 DELETE**：帳務表只前進狀態、不刪列。填錯就再 UPDATE 修正並在 reason/note 留痕。
4. **一次一單**：修復 SQL 一律帶 `order_no`／`merchant_trade_no` 條件與狀態守衛（`and status='...'`），不跑批次。
5. **修完自問**：這是個案還是 pattern？同情境第二次出現→開任務把它自動化或修根因（`coding-system.md` §3.5）。

## 9. 何時聯絡綠界（客服 02-2655-1775）

- 綠界後台查無交易但客人有扣款證明（銀行對帳單）。
- 退刷操作失敗或超過可退期限。
- 查詢 API 持續 403／異常回應超過一天。
- 對帳結果與後台顯示不一致。

準備資訊：MerchantID、MerchantTradeNo（19 碼）、綠界 TradeNo、交易日期與金額。
