# 04-1. 付款流程（Payment Flows）

> 以 Sequence Diagram 表達三大類付款流程：即時付款（一段式）、取號付款（二段式）、嵌入式（站內付 2.0）。所有流程的共同前提：金額由伺服器端重算、建單參數伺服器端組裝與簽章。

## 1. AIO 即時付款（信用卡／WebATM／TWQR／微信／Apple Pay）

```mermaid
sequenceDiagram
    autonumber
    actor C as 消費者
    participant FE as 特店前端
    participant BE as 特店後端
    participant EC as ECPay(payment)

    C->>FE: 結帳
    FE->>BE: 建立訂單請求
    BE->>BE: 伺服器端重算金額、產生 MerchantTradeNo(唯一)、組參數、計算 CheckMacValue
    BE-->>FE: 回傳自動送出表單(Form POST 參數)
    FE->>EC: 瀏覽器 Form POST 導轉 /Cashier/AioCheckOut/V5
    Note over C,EC: 消費者在綠界頁面完成付款(含 3D 驗證，AIO 對特店透明)
    par Server 端(權威結果)
        EC->>BE: ReturnURL: Form POST 付款結果(RtnCode='1' 字串)
        BE->>BE: 驗章→比對金額→冪等更新為 paid
        BE-->>EC: 純文字 1|OK (HTTP 200)
    and Client 端(顯示用)
        EC->>FE: OrderResultURL: Form POST 導回(與 ReturnURL 無固定先後)
        FE->>C: 顯示結果頁(向後端查本地狀態，不直接信 POST 內容)
    end
```

**規則**：

- OrderResultURL 僅供顯示；**訂單狀態只能由 ReturnURL（或主動查詢）驅動**。兩者到達順序不固定，結果頁需支援「付款處理中」的輪詢本地狀態。
- 銀聯卡與非即時交易不支援 OrderResultURL，結果頁一律要能在「只有 ClientBackURL 導回」的情況下運作。
- iframe 禁用；LINE/Facebook 內建 WebView 會導致付款失敗，需引導外部瀏覽器開啟。

## 2. AIO 取號付款（ATM／超商代碼／超商條碼）——二段式

```mermaid
sequenceDiagram
    autonumber
    actor C as 消費者
    participant BE as 特店後端
    participant EC as ECPay(payment)
    participant S as 超商/ATM 通路

    Note over C,EC: 第一段：取號
    C->>EC: 於綠界頁面選擇 ATM/CVS/BARCODE
    EC->>BE: PaymentInfoURL: 取號結果(ATM RtnCode='2'／CVS·BARCODE RtnCode='10100073')
    BE->>BE: 驗章→存繳費資訊(帳號/代碼/條碼＋ExpireDate)→狀態 info_issued
    BE-->>EC: 1|OK
    EC->>C: 顯示繳費資訊(特店也應以 Email/頁面提供)

    Note over C,S: 第二段：繳費(可能數天後)
    C->>S: 臨櫃/轉帳繳費
    S->>EC: 通路回報入帳
    EC->>BE: ReturnURL: 付款結果(RtnCode='1')
    Note right of EC: 超商條碼：約付款完成後兩天才回傳
    BE->>BE: 驗章→冪等更新 info_issued→paid
    BE-->>EC: 1|OK
```

**規則**：

- **必須同時實作 PaymentInfoURL 與 ReturnURL 兩個端點**；漏做 PaymentInfoURL 消費者拿不到繳費資訊。
- 取號成功碼（2／10100073）不是錯誤；把它判為失敗而取消訂單是官方點名的高頻 bug。
- 繳費期限（ExpireDate）過後不會有任何回呼，逾期判定靠本地排程＋對帳檔。
- 官方明示 ATM/CVS/BARCODE **不要主動輪詢**查詢 API，等回呼即可（客服個案查詢除外）。
- 超商代碼 `StoreExpireDate` 單位是分鐘、條碼是天——同名參數在不同付款方式單位不同。

## 3. BNPL 無卡分期（審核型）

```mermaid
sequenceDiagram
    autonumber
    actor C as 消費者
    participant BE as 特店後端
    participant EC as ECPay
    participant F as 融資公司(裕富/銀角零卡)

    C->>EC: 選擇 BNPL(金額≥3,000)
    EC->>F: 送審
    Note over BE: TradeStatus=0 代表「申請受理中」，非未付款
    F-->>EC: 審核結果(非即時)
    EC->>BE: ReturnURL／無卡分期申請結果通知
    BE->>BE: 驗章→成功(1)/失敗(10200163)更新狀態
    BE-->>EC: 1|OK
```

- BNPL **只能**靠通知收結果，官方明示不可主動輪詢。

## 4. 站內付 2.0（嵌入式，AES-JSON、雙網域）

```mermaid
sequenceDiagram
    autonumber
    actor C as 消費者
    participant FE as 特店前端(JS SDK)
    participant BE as 特店後端
    participant G as ecpg.ecpay.com.tw
    participant E as ecpayment.ecpay.com.tw

    FE->>BE: 結帳
    BE->>G: GetTokenbyTrade(AES 加密 Data，含 ConsumerInfo)
    G-->>BE: TransCode=1 + Data{RtnCode=1, Token}
    BE-->>FE: Token
    FE->>FE: SDK 渲染付款元件(容器 ID 固定 ECPayPayment)
    C->>FE: 輸入卡號(直送綠界，不經特店後端)
    FE->>BE: 付款代碼(PayToken)
    BE->>G: CreatePayment
    G-->>BE: 回應(可能含 ThreeDInfo.ThreeDURL)
    alt 有 ThreeDURL(2025/8 起幾乎必現)
        BE-->>FE: ThreeDURL
        FE->>C: window 導向 3D 驗證頁(未導向→交易逾時失敗)
        C->>G: 完成 3D 驗證
    end
    par
        G->>BE: ReturnURL: JSON POST(AES Data，RtnCode 整數)
        BE-->>G: 1|OK
    and
        G->>FE: OrderResultURL: Form POST(ResultData 欄位)
        FE->>C: 結果頁
    end
    Note over BE,E: 後續查詢/退款改打 ecpayment 網域(打錯網域→404)
```

**規則**：

- 雙網域路由集中在傳輸模組，不允許呼叫端自行組 URL。
- 回應一律雙層檢查：TransCode（傳輸層）→ 解密 → RtnCode（業務層，整數）。
- ATM/CVS/BARCODE 走站內付時：CreatePayment 回應即含繳費資訊，需顯示給消費者；ReturnURL 於實際繳費後非同步到達。
- Apple Pay 需先完成網域驗證、Merchant ID 申請、憑證上傳，按鈕才會顯示。

## 5. 綁定信用卡（Token 快付）

```mermaid
flowchart LR
    A["GetTokenbyBindingCard\n(ecpg)"] --> B["前端輸卡"] --> C["CreateBindCard\n(ecpg)"] --> D[("儲存綠界卡片 ID\n特店不存卡號")]
    D --> E["回頭客結帳:\nCreatePaymentWithCardID"] --> F["3D/授權流程同站內付"]
    D --> G["GetMemberBindCard 列卡\nDeleteMemberBindCard 解綁\n(解綁前先 GetTokenbyUser 取驗證碼)"]
```

## 6. 幕後授權／幕後取號（純後台）

- **幕後授權**（BackAuth）：特店自建輸卡介面→後端送卡號授權。流程最短但 PCI SAQ-D；ReturnURL 為 JSON POST、回 `1|OK`。
- **幕後取號**（GenPaymentCode）：後端直接產生 ATM 帳號/超商代碼/條碼，自行呈現給消費者；繳費結果經付款結果通知（JSON）到達，其後流程同 §2 第二段。

## 7. 建單參數組裝的通用檢核（送出前）

1. 金額為正整數、與伺服器端重算結果一致。
2. MerchantTradeNo ≤20 英數、資料庫 UNIQUE 先行占位。
3. MerchantTradeDate 為 UTC+8。
4. ItemName ≤400 字元（先截斷再簽章）、無 HTML 標籤、無控制字元、無系統指令關鍵字（WAF）。
5. ReturnURL/OrderResultURL/ClientBackURL 三者互異、皆為 80/443、非 CDN、非中文網址。
6. 依付款方式附掛正確的專屬參數（見 `02-api-capability-matrix.md` §1.2）。
