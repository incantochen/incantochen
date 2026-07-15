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
