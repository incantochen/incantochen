# 03-3. 狀態機（State Diagram）

> 金流正確性的核心是狀態機：每個狀態轉移只允許由「已驗章的回呼」「已驗章的查詢結果」或「對帳檔」觸發，且必須冪等。

## 1. 付款狀態機（特店本地，PAYMENT_ATTEMPT.status）

```mermaid
stateDiagram-v2
    [*] --> pending : 建單送出
    pending --> paid : ReturnURL RtnCode=1（驗章通過）
    pending --> info_issued : PaymentInfoURL 取號成功\n（ATM RtnCode=2／CVS·BARCODE RtnCode=10100073）
    info_issued --> paid : ReturnURL RtnCode=1\n（消費者臨櫃/轉帳繳費後）
    info_issued --> expired : 超過 ExpireDate 未繳費\n（無回呼，靠排程判定）
    pending --> failed : ReturnURL RtnCode≠1\n或查詢 TradeStatus=10200095
    pending --> abandoned : 消費者未進入付款\n（逾時排程判定）
    paid --> [*]
    note right of info_issued
        取號成功 ≠ 付款成功。
        把 RtnCode=2 / 10100073 判為錯誤
        是官方點名的高頻 bug。
    end note
    note right of expired
        繳費期限過後綠界不會發通知，
        「逾期」是特店自己的排程推論；
        對帳檔是最終依據。
    end note
```

**轉移守則**：

1. `paid` 是吸收態：重送的 ReturnURL 到達時，狀態已是 `paid` 就只記 event、不再轉移（冪等）。
2. `SimulatePaid=1` 的通知可轉移狀態供測試，但**不得觸發出貨等副作用**。
3. BNPL 特例：`pending` 期間 TradeStatus=0 表示「申請受理中」而非未付款；只能等 ReturnURL，不可輪詢。

## 2. 信用卡帳務狀態機（綠界端，DoAction 操作對象）

依官方 2885 頁的動作與適用狀態整理：

```mermaid
stateDiagram-v2
    [*] --> authorized : 授權成功（占用額度）
    authorized --> closing : 關帳 C（請款）
    authorized --> abandoned : 放棄 N（釋放額度，全額）
    closing --> closed : 綠界向銀行完成請款\n（每日約 20:15-20:30 自動關帳）
    closing --> cancelled : 取消 E（僅全額退款路徑）
    cancelled --> abandoned : 放棄 N
    closing --> refunded : 退刷 R（部分或全額）
    closed --> refunded : 退刷 R（部分或全額）
    abandoned --> [*]
    refunded --> [*]
    note right of authorized
        21 天內須完成關帳；
        逾 90 天系統自動放棄。
        銀聯卡：授權完成即自動關帳
        （無 authorized 停留）。
    end note
    note right of refunded
        分期付款、紅利折抵：僅能全額退刷。
        退刷需綠界帳戶餘額足夠。
    end note
```

**退款決策表**（由本地 Refund 模組實作）：

| 綠界帳務狀態 | 想全額退 | 想部分退 |
|-------------|---------|---------|
| 已授權（authorized） | 放棄 N | 不可（尚未請款） |
| 要關帳（closing） | 取消 E → 放棄 N | 退刷 R（僅一般授權） |
| 已關帳（closed） | 退刷 R | 退刷 R（僅一般授權） |
| 操作取消（cancelled） | 放棄 N | — |

## 3. 退款請求狀態機（特店本地）

```mermaid
stateDiagram-v2
    [*] --> requested : 客服/系統發起
    requested --> precheck : 查詢信用卡單筆明細\n確認帳務狀態與 PaymentType
    precheck --> rejected : 非信用卡類\n（ATM/CVS/BARCODE 無退款 API→轉人工）
    precheck --> executing : 依決策表選 C/R/E/N
    executing --> succeeded : DoAction RtnCode=1
    executing --> failed : DoAction RtnCode≠1\n（含 error_overDate→聯繫客服）
    failed --> executing : 人工確認後重試
    succeeded --> [*]
    note right of executing
        避開每日 20:15-20:30（自動關帳時段）。
        DoAction 僅正式環境可用，
        測試環境無法演練→見 05-testing。
    end note
```

## 4. 定期定額合約狀態機

```mermaid
stateDiagram-v2
    [*] --> first_auth : 建單（含 Period 參數）
    first_auth --> active : 首期授權成功（進入排程）
    first_auth --> dead : 首期授權失敗\n（官方：不進排程，需重新建單）
    active --> active : 每期授權成功\n（PeriodReturnURL 通知，fail_streak 歸零）
    active --> grace : 當期授權失敗\n（fail_streak +1，等下次扣款或 ReAuth）
    grace --> active : ReAuth 補授權成功\n（限最新一筆失敗）
    grace --> auto_cancelled : 連續失敗達 6 次\n（綠界自動取消後續扣款）
    active --> terminated : Cancel 終止（不可逆）
    grace --> terminated : Cancel 終止（不可逆）
    active --> completed : 達 ExecTimes 期滿
    terminated --> [*]
    completed --> [*]
    auto_cancelled --> [*]
    note right of grace
        無「暫停/恢復」API；
        僅 ReAuth 與 Cancel 兩種作業，
        其餘變更需廠商後台人工操作。
    end note
```

## 5. 對帳比對結果狀態機

```mermaid
stateDiagram-v2
    [*] --> compared : 每日對帳排程比對
    compared --> matched : 金額/狀態一致 → 標記已對帳
    compared --> amount_mismatch : 金額不符 → 告警＋凍結該單後續動作
    compared --> missing_local : 對帳檔有、本地無 → 漏回呼，補查詢重建
    compared --> missing_remote : 本地有、檔內無 → 可能未完成付款，主動查詢確認
    amount_mismatch --> resolved : 人工裁決（不自動改帳）
    missing_local --> resolved : 補建紀錄後重跑比對
    missing_remote --> resolved : 確認為未付款/逾期
    matched --> [*]
    resolved --> [*]
```
