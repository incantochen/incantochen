# 03-2. 資料模型（ER Diagram）

> 支撐金流整合所需的最小資料模型。命名為邏輯名稱，各專案可映射到自己的實體表；欄位取捨理由見 §3。

## 1. ER Diagram

```mermaid
erDiagram
    ORDER ||--o{ PAYMENT_ATTEMPT : "一張訂單可多次嘗試付款"
    PAYMENT_ATTEMPT ||--o{ WEBHOOK_EVENT : "一次付款可收多筆回呼(重送)"
    PAYMENT_ATTEMPT ||--o{ REFUND : "一筆已付款可多次部分退款"
    PAYMENT_ATTEMPT ||--o{ PAYMENT_INFO : "非即時付款有取號資訊"
    ORDER ||--o| PERIOD_CONTRACT : "訂閱訂單對應定期定額合約"
    PERIOD_CONTRACT ||--o{ PERIOD_EXECUTION : "每期授權一筆"
    PAYMENT_ATTEMPT ||--o{ RECON_MATCH : "對帳比對結果"
    RECON_FILE ||--o{ RECON_MATCH : "一份對帳檔多筆比對"
    PAYMENT_ATTEMPT ||--o| INVOICE_REQUEST : "付款完成後開立發票"

    ORDER {
        string order_no PK "業務訂單號"
        int amount "訂單金額(正整數 TWD)"
        string status "訂單狀態機(見03-3)"
        datetime created_at
    }
    PAYMENT_ATTEMPT {
        string merchant_trade_no PK "送綠界的唯一編號(<=20英數) UNIQUE"
        string order_no FK
        string ecpay_trade_no "綠界TradeNo(回呼後回填)"
        string service "aio | ecpg | back_auth | back_num"
        string choose_payment "送出付款方式"
        string payment_type "回傳付款方式(值域不同)"
        int amount "本次請求金額"
        string status "pending|info_issued|paid|failed|expired"
        int simulate_paid "模擬付款旗標(1=不可出貨)"
        datetime paid_at
        datetime last_reconciled_at "最後對帳時間"
    }
    WEBHOOK_EVENT {
        string id PK
        string merchant_trade_no FK
        string kind "return|payment_info|period|order_result|bnpl"
        string raw_payload "原文全文(稽核/重放分析)"
        bool mac_verified "驗章結果"
        string rtn_code
        datetime received_at
        datetime processed_at "冪等處理完成時間"
    }
    PAYMENT_INFO {
        string merchant_trade_no FK
        string kind "atm|cvs|barcode"
        string bank_code "ATM"
        string v_account "ATM虛擬帳號"
        string payment_no "CVS繳費代碼"
        string barcode_1_2_3 "條碼三段"
        datetime expire_date "繳費期限"
    }
    REFUND {
        string id PK
        string merchant_trade_no FK
        string action "C|R|E|N"
        int amount
        string status "requested|succeeded|failed"
        string operator "操作者(稽核)"
        datetime created_at
    }
    PERIOD_CONTRACT {
        string merchant_trade_no PK "首期交易編號"
        string period_type "D|M|Y"
        int frequency
        int exec_times "總期數"
        int period_amount "每期金額"
        string status "active|terminated|failed_out"
        int fail_streak "連續失敗數(6次自動取消)"
    }
    PERIOD_EXECUTION {
        string id PK
        string contract_no FK
        int seq "期數"
        string rtn_code
        string gwsr "授權單號"
        datetime executed_at
    }
    RECON_FILE {
        string id PK
        string kind "trade_media|funding_recon"
        string date_type "2|4|6 或 fund|close|enter"
        date begin_date
        date end_date
        string format "V1|V2|V3"
        datetime downloaded_at
    }
    RECON_MATCH {
        string id PK
        string recon_file_id FK
        string merchant_trade_no
        string result "matched|amount_mismatch|missing_local|missing_remote"
        string resolution "人工裁決結果"
    }
    INVOICE_REQUEST {
        string id PK
        string merchant_trade_no FK
        string relate_number "發票關聯編號"
        string invoice_no "開立後回填"
        string status "pending|issued|failed|void|allowance"
    }
```

## 2. 唯一性與併發約束（金流正確性的底線）

| 約束 | 理由 |
|------|------|
| `PAYMENT_ATTEMPT.merchant_trade_no` UNIQUE | 官方規定不可重複；同時是回呼冪等的鎖定鍵 |
| 回呼處理採**條件式 UPDATE**（`WHERE status='pending'` 之類）而非先查後寫 | 綠界重送最多 4 次＋多節點部署下，check-then-act 必有 race；且 SET 必須改動 WHERE 用到的欄位，否則 READ COMMITTED 下兩個併發請求都會通過條件 |
| `WEBHOOK_EVENT` 永遠 INSERT（append-only），業務狀態只在 `PAYMENT_ATTEMPT` 更新 | 事件原文保留供稽核與重放分析；重送事件會有多筆 event，但狀態轉移只發生一次 |
| `REFUND` 與 `PAYMENT_ATTEMPT` 分表 | 一筆付款可多次部分退刷（一般授權），退款是獨立生命週期 |
| 金額欄位一律整數（TWD 無小數） | 官方規定；避免浮點誤差 |

## 3. 欄位取捨理由

- **`raw_payload` 必存**：對帳差異、客訴、與綠界爭議時的唯一證據；也支援日後「重放事件重建狀態」。
- **`simulate_paid` 必存**：官方明示 SimulatePaid=1 的交易不可出貨；漏存會導致測試交易觸發真實出貨。
- **`payment_type`（回傳值）與 `choose_payment`（送出值）分開存**：兩者值域不同（送 `Credit` 回 `Credit_CreditCard`），退款前要用回傳值判斷是否為信用卡類。
- **`ecpay_trade_no` 必存**：DoAction 退款需要 MerchantTradeNo＋TradeNo 雙識別，只存單邊會讓退款做不了。
- **`last_reconciled_at`**：讓每日對帳能以「未對帳」為查詢條件增量處理。
- **`fail_streak`**：官方規則「連續失敗 6 次自動取消」，本地需要鏡射此狀態以主動通知用戶。
