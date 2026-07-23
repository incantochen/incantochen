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

> ℹ️ **T110 之後的失敗語意**：訂單狀態推進與 `order_status_log` 稽核寫入已交易化（`transition_order_status` RPC）——log 寫不進去時**整筆推進會 rollback 並回錯誤**（webhook 回 0|ERR 觸發 ECPay 重送、對帳隔日重試），不再出現「狀態已變但稽核缺漏」。反面代價：若 `order_status_log` 本身持續寫入失敗（如未來 migration 的約束／trigger 回歸），**所有**狀態推進（webhook／對帳／後台按鈕）會同時失敗——Sentry 看到大量「訂單狀態更新失敗」時先查該表，不要當一般 DB 抖動處理。
>
> 🛡️ **降低此風險的實務（動 `order_status_log` 前必讀）**：
>
> 1. **任何改動 `order_status_log` 的 migration**（加 CHECK／NOT NULL／trigger、改 RLS、增刪欄位）**先在 staging 實跑一輪真實狀態轉換**（沙盒 webhook 結算 ＋ 後台改一筆狀態），確認 INSERT 仍寫得進去再上正式。關鍵認知：`create function`／套 migration「成功」**不代表** RPC 內的 INSERT 跑得動——函式體不在套用當下執行，型別／約束錯誤只在**被呼叫時**才浮現（T110 的 RPC 即靠此程序在雲端以 miss／raise／hit+rollback 三態驗過）。
> 2. **為 Sentry 設 P0 告警規則**，命中訊息 `ensureOrderPaid failed`／`訂單狀態更新失敗`／`transition_order_status`：這類事件語意已從「稽核小瑕疵」升級為「訂單流程全線中斷」，不可淹沒在一般錯誤流裡（此告警觸發＝結帳／付款／後台履約可能同時停擺，需即刻查 `order_status_log`）。
> 3. **`order_status_log` 維持極簡 append-only**（現況：`text`／`uuid`／`bool`／`timestamptz`，除 `order_id`／`actor_id` 兩個 FK 外無其他約束）。要加任何會讓 INSERT 可能失敗的約束前，先評估是否值得用「全線狀態推進」當賭注——多數稽核性欄位驗證應放在應用層或非阻塞的事後檢查，而非這條交易關鍵路徑上。
>
> ℹ️ **T107 之後的正常漂移態**：自動對帳的推進順序是「先 orders、payment 翻 paid 留最後」（失敗時保留候選鍵供隔日重試），故可能短暫看到「`orders.status='paid'` 但 `payment.status='pending'`」——這是自癒中（隔日 cron 的 CAS 會補翻），**勿**誤判成異常手動改。連續兩天以上仍漂移才依上述步驟處理。本節 §8 的「先 payment 再 orders」是**人工修復**的權威同步順序，與自動對帳的重試鍵保留是兩回事，不衝突。

### 1.1 對帳各失敗點的實際體驗與自癒時間（T107 使用者體驗矩陣）

> 前提都是 webhook 已先失靈（否則輪不到對帳出手）、客人在綠界**已成功扣款**。對帳 cron 現行每日一次（台北 02:00）；T126（改小時級）落地後本表的「隔日／每日」同步更新。

| 失敗點                                     | 客人看到什麼                                                 | 店家看到什麼                                                                                                                                                                                                                                                     | 自癒時間                                                                      |
| ------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| ① 訂單推進失敗（DB 暫時錯誤）              | 付了款但訂單仍「待付款」、沒收到確認信                       | Sentry exception ＋ cron summary `unexpected` +1                                                                                                                                                                                                                 | 隔日 cron 冪等重試（連續多日同一筆才走本節上方步驟）                          |
| ② payment 翻 paid 失敗                     | **幾乎無感**——訂單已顯示已付款、確認信照寄（③不被②擋）       | 訂單 paid／payment pending 漂移（見上方註記，勿手動改）；唯一風險窗口：漂移期間要退款的話，`gateway_trade_no` 尚未落地——去綠界後台用 `merchant_trade_no` 查（§3 同一條路）                                                                                       | 隔日 cron CAS 補翻                                                            |
| ③ 確認信寄送失敗                           | 訂單狀態、金額都正常，只是**信晚到**；急的客人可在訂單頁自查 | `notifyFailed` 告警；連續 2–3 天同一筆 → §4 人工介入                                                                                                                                                                                                             | 每日 sweep 補寄                                                               |
| ④ webhook 側卡單（見下方）                 | 付了款但訂單仍「待付款」、沒收到確認信                       | `payment.status='paid'` 但 `orders.status='pending_payment'`；Sentry warning「promoted webhook-side stuck order」＋summary `driftPromoted`（自癒當下發）；卡單期間若逼近 72h，另有逾期 cron 被取消守衛擋下的 error 告警「paid payment exists on expiring order」 | 隔日 cron 漂移臂冪等推進（T127；連續兩天仍漂移才走 §1 判斷步驟 1 的分支人工） |
| ⑤ 訂單已關閉仍收到錢（逾期取消後付款成立） | 訂單顯示已取消，但卡已被扣款                                 | error 告警「reconcile: money received on closed order」＋summary `promotedOnClosedOrder`；payment 已翻 paid、訂單維持 cancelled／refunded。**此狀態另有每日 recurring 稽核臂復發偵測**（見下方 ⑥）                                                               | **不自癒**——人工裁決退款或恢復訂單（§6.1）                                    |
| ⑥ 錢收在已取消訂單上（durable 稽核）       | 同⑤（訂單已取消、卡已扣款）                                  | 每日對帳 recurring 稽核臂（鍵 `payment=paid ∧ orders=cancelled`）error 告警「reconcile: paid payment on cancelled order」＋summary `paidOnCancelled`——**主臂／漂移臂都撈不到這種列**，這支是它的 durable 兜底（不靠取消當下的單次告警）                          | **不自癒**——人工裁決（§6.1），但每日重複偵測直到處理                          |

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

## 6. 退款（T47 記錄式流程：後台登記，實際刷退仍走綠界後台）

1. 售後申請確認要退款（`/admin/orders/[id]` 售後區塊）。
2. **綠界廠商後台**對該筆交易操作退刷（信用卡）；記下退刷結果。
3. `/admin/orders/[id]` → **退款區塊**：填退款原因（進 order_status_log note，寫明退刷單據／日期）＋勾「已於綠界後台完成實際退刷」→ 登記退款。系統自動：**payment 翻 `refunded`＋訂單 CAS 轉 `refunded`＋稽核 log 於單一交易內原子完成**（`refund_order` RPC，migration 0020；CAS 未命中整筆 rollback、payment 翻面一併還原——不會留下「payment 已退、訂單沒退」的半套狀態）→ 寄退款通知信給客人（sendOnce 去重；寄失敗顯示 warning，每日 reconcile sweep 自動補寄）。整段冪等，中途失敗重按一次即收斂。
4. ⚖️ 已開電子發票（T42 之後）須折讓／作廢——會計流程未定案前，先記錄在訂單 note，發票開立後不可略過此步（退款區塊在已開發票時會紅字提醒）。
5. 退款不走操作欄一鍵轉換（server 端也擋）；Admin Override 仍保留為逃生口，但走 Override 不會翻 payment、不寄通知信——正常退款一律走退款區塊。**若已誤走 Override**（訂單 refunded、payment 仍 paid 的半套狀態）：回訂單詳情頁退款區塊，會出現「補登記退款」入口——補登記走 `repair_refunded_payment` 原子 RPC（0021）：補翻 payment＋寫稽核 log（note 帶 `[退款補登記]` 前綴）單一交易完成，再補寄通知信（對已 refunded 訂單冪等重入）。此半套狀態也由 reconcile `paid payment on refunded order` 稽核臂每日 durable 偵測（§6.1）。
6. pending_payment（webhook 卡單，§1.1 第④類）與 cancelled（§6.1）訂單**不可**在退款區塊登記（伺服器端會擋）——這類單屬人工裁決，依 §6.1 流程處理。

### 6.1 錢收在已關閉／已取消訂單上（人工裁決）

**觸發本節的四個 Sentry 訊號**（成因不同，裁決流程相同）：

| Sentry 訊息                                                            | summary 計數            | 成因                                                                                                                                                                                         | 復發偵測                              |
| ---------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `reconcile: money received on closed order`                            | `promotedOnClosedOrder` | 對帳（主臂或漂移臂）向綠界／依財務事實推進時，重查發現訂單已 cancelled／refunded                                                                                                             | 單次（payment 已 paid，隔日不再入選） |
| `transitionOrder: money received on order cancelled during transition` | —                       | 取消守衛的 TOCTOU 毫秒窄窗：pre-guard 查無 paid、CAS 取消 commit 後才查到 payment 已 paid                                                                                                    | 單次（取消當下發）                    |
| `reconcile: paid payment on cancelled order`                           | `paidOnCancelled`       | **durable 稽核臂**：每日掃 `payment=paid ∧ orders=cancelled`——上面兩種單次訊號漏看、或 T127 部署前既有列，都會被這支每日重新撈到告警                                                         | **每日重複**直到處理                  |
| `reconcile: paid payment on refunded order`                            | `paidOnRefunded`        | **durable 稽核臂（T47）**：每日掃 `payment=paid ∧ orders=refunded`——成因＝Admin Override 直接把訂單改 refunded（逃生口，不翻 payment）。裁決＝回退款區塊按「補登記退款」補翻 payment＋補寄信 | **每日重複**直到處理                  |

**成因總述**：逾期自動取消／人工取消後客人才完成付款，或取消與 webhook 結算的窄窗競態。payment 照翻／維持 `paid`（`gateway_trade_no`／`raw_callback` 已落地＝日後退款的依據），訂單維持 cancelled／refunded。**不自癒**——錢收了但訂單不會自動復活，必須人工裁決。

**判斷**：跑 §0 查詢確認 `orders.status`（cancelled／refunded）＋`payment.status='paid'`；到綠界後台核對實收金額與 TradeNo。

**裁決（二選一，先聯絡客人確認意願）**：

1. **退款**：綠界後台對該筆交易退刷（操作同 §5），完成後 payment 標 `refunded`（同 §5 SQL）；人工 email 告知客人（3–7 個工作天入帳）。
2. **恢復訂單**：客人仍要商品且交期可接受 → `/admin/orders/[id]` Admin Override 把訂單改 `paid`（reason 寫明「取消後付款成立，經客人確認恢復訂單」），再依 §4 補寄確認信。

⚠️ 前兩個訊號是**單次**的——收到當日就要處理，別等第二封。後兩個（`paid payment on cancelled order`、`paid payment on refunded order`）是 durable 兜底，會**每日重複告警**直到你把該列裁決掉，是「還沒處理」的每日催辦，不是新事件。`paid payment on refunded order` 兩種成因，處置不同：

- **Admin Override 逃生口**留下的「訂單已退款、payment 仍 paid」半套——回退款區塊按「補登記退款」即補翻 payment＋補寄通知信。
- **重複付款的兄弟交易在退款後才成立**（§5 情境：客人重刷留下一筆 pending，你依已付款那筆退款結案後，綠界才回報這筆 pending 也成功→翻成 paid 掛在已退款單上）——客人實際被扣兩次、你只退了一筆。**去綠界後台把第二筆也退刷**，再回退款區塊補登記（payment 同步翻 refunded）。這是**刻意不在程式端自動壓掉**的：pending 兄弟收到成功回呼＝真錢已入帳，把它標 failed 會讓真金流在系統裡隱形，比告警更糟；webhook 翻面當下就會發 `money received on closed order` 單次訊號，本臂每日催辦到你處理完。

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

---

## 10. 個資權利請求處理（T63）

當事人（會員本人）依《個資法》來信要求**查詢／更正／刪除**自己的個資。MVP 為人工受理（email）＋管理員手動處置，無前台自助表單。

> ⚠️ **刪除＝匿名化，非真刪**：`orders.member_id → member` 為 FK RESTRICT、`member.id → auth.users cascade`——有訂單的會員無法實體刪除。刪除請求一律以匿名化落地：洗去可識別個資、**保留帳務鏈**（金額／`order_no`／發票號／金流交易號）以符稅務與對帳保存義務（§8 紅線「帳務表禁 DELETE」）。

### 10.0 前置：身分驗證（未驗證不處置）

請求者須證明為帳號本人，擇一：

- 從註冊 email 發信往返確認；或
- 引導其以該 email 走 OTP 登入、於已登入狀態提出。

冒名請求會導致把他人個資揭露／洗掉，**驗不過一律不處置**。

### 10.1 查詢（資料可攜／查閱）

以 service role 匯出該會員個資：

```sql
select * from public.member where id = '<member_id>';
select id, order_no, status, recipient_name, recipient_phone, shipping_address,
       zip_code, tracking_no, invoice_no, invoice_meta, total_amount, created_at
  from public.orders where member_id = '<member_id>';
select oi.* from public.order_item oi
  join public.orders o on o.id = oi.order_id
 where o.member_id = '<member_id>';
select * from public.support_request where member_id = '<member_id>';
```

### 10.2 更正

更正 `member` profile：

```sql
update public.member set name = '<新值>' where id = '<member_id>';
```

> **已成立訂單快照為契約凍結、不回寫**：`orders` 的 `recipient_*`／`config_snapshot`／`unit_price_snapshot` 是下單當下的契約，只更正 member profile 與未來訂單，不改既有訂單（對齊「訂單成立即契約」規則）。

### 10.3 刪除＝匿名化

以 `postgres`／service role 於 Supabase SQL 執行原子 RPC（migration 0023）：

```sql
select public.anonymize_member(
  '<member_id>',        -- 目標會員
  '<admin_auth_id>',    -- 管理員的 auth.users id（稽核 actor）
  '<admin_email>'       -- 管理員 email
);
```

- `<admin_auth_id>` **須為有效 auth.users id**，否則 `pii_erasure_log` FK 違反、整筆 rollback。
- 冪等：已匿名的會員再呼叫回 `U0011`（SQLSTATE）；查無會員回 `U0010`。
- RPC 洗：`member.email/name`、`orders` 收件四欄＋面交 `tracking_no` 備註＋`invoice_meta` 的 `carrier_num`／`customer_identifier`、`payment.raw_callback`、`support_request.description`；保留帳務欄位、宅配單號、發票稅務結果。

**接著手動處置 RPC 碰不到的兩處：**

1. **auth.users**（RPC 只動 public schema）：Supabase Dashboard → Authentication → 該用戶 → **Ban user**（停用登入）＋將 auth email 覆寫為匿名值（best-effort 抹除真實 email）。因 orders RESTRICT，auth 帳號永遠無法實體刪除，離線紀錄保留、僅停用——為接受取捨。
2. **order_status_log.note**（append-only 稽核，不機械洗）：逐列人工檢視、發現客人姓名/電話等 PII 才個案處置：

```sql
select id, order_id, note from public.order_status_log
 where order_id in (select id from public.orders where member_id = '<member_id>')
   and note is not null;
```

提醒團隊：日後勿在 note 打客人個資。

**驗證：**

```sql
select id, email, name, anonymized_at from public.member where id = '<member_id>';
select * from public.pii_erasure_log where target_member_id = '<member_id>';
```

`member.anonymized_at` 應有值、`pii_erasure_log` 應有一列。

### 10.4 紅線與登錄

- **帳務欄位保留、匿名化非真刪、禁 DELETE**（引 §8）。
- 於**人工個資請求記錄簿**登錄本次處理：日期／請求類型（查詢/更正/刪除）／身分驗證結果／處置範圍（member_id、受影響訂單數）。
