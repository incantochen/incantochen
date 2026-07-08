# 02. API 能力對照矩陣（API Capability Matrix）

> 每個金流相關 API 的：用途、流程位置、相依性、限制、適用情境、注意事項。
> 端點路徑以官方文件為準；「測試環境不可用」等限制均出自官方頁面。
> 回呼（Webhook）不是特店呼叫的 API，但屬於能力面的一部分，一併列於 §5。

## 1. AIO 全方位金流（CMV-SHA256，`payment.ecpay.com.tw`）

### 1.1 產生訂單（AioCheckOut）

| 項目 | 內容 |
|------|------|
| 端點 | `/Cashier/AioCheckOut/V5`（Form POST，由消費者瀏覽器導轉送出） |
| 用途 | 建立訂單並將消費者導轉至綠界付款頁 |
| 流程位置 | 付款流程的起點（見 `04-flows/01`） |
| 相依性 | 無前置 API；後續相依 ReturnURL（必填）、OrderResultURL/PaymentInfoURL/PeriodReturnURL（依付款方式） |
| 關鍵參數 | MerchantID、MerchantTradeNo（20 字元英數唯一）、MerchantTradeDate（UTC+8）、PaymentType=`aio`、TotalAmount（正整數）、TradeDesc、ItemName（≤400 字元，多筆以 `#` 分隔）、ReturnURL、ChoosePayment、CheckMacValue、EncryptType=1 |
| 限制 | 不可用 iframe；iOS 的 Facebook/LINE 內建 WebView 無法完成結帳；WebATM 不支援手機版；Apple Pay 僅 Safari 顯示；銀聯卡與非即時交易不支援 OrderResultURL；ItemName 超長截斷會造成 CheckMacValue 不符掉單 |
| 適用情境 | 絕大多數電商收款（導轉式）；`ChoosePayment=ALL` 搭配 `IgnorePayment` 可讓消費者自選付款方式 |
| 注意事項 | 回應是「頁面導轉」而非 JSON；ReturnURL 與 OrderResultURL 不可設同一位址；含 `%26`、`%3C` 的參數需先 urldecode |

### 1.2 各付款方式（同一建單端點，以 ChoosePayment 與附加參數區分）

| 付款方式 | ChoosePayment | 專屬參數／規則 | 完成模式 |
|---------|--------------|---------------|---------|
| 信用卡一次付清 | `Credit` | `UnionPay=1` 可走銀聯 | 即時 |
| 信用卡分期 | `Credit` | `CreditInstallment=3,6,12,18,24,30`；不可與定期定額/紅利並用；**分期退款一定全額退刷** | 即時 |
| 信用卡定期定額 | `Credit` | `PeriodAmount`（=TotalAmount）、`PeriodType`(D/M/Y)、`Frequency`（D:1–365／M:1–12／Y:1）、`ExecTimes`（≥2；D/M ≤999、Y ≤99）、`PeriodReturnURL`；不支援銀聯；失敗 6 次自動取消；首次授權失敗不入排程 | 即時＋排程 |
| 消費者自費分期 | （依官方 41284 頁） | 分期利息由消費者負擔 | 即時 |
| Apple Pay | `ApplePay` | 僅手機 Safari | 即時 |
| ATM 虛擬帳號 | `ATM` | 取號→繳費二段式；`ExpireDate` 繳費期限 | 非即時（二段） |
| 超商代碼 | `CVS` | 取號→繳費二段式；勿販售遊戲點數/虛寶 | 非即時（二段） |
| 超商條碼 | `BARCODE` | 取號→繳費二段式；**付款完成約兩天後才回傳通知** | 非即時（二段） |
| WebATM | `WebATM` | 手機版不支援 | 即時 |
| TWQR | `TWQR` | 行動支付掃碼 | 即時 |
| BNPL 無卡分期 | `BNPL` | 最低 3,000 元；**只能靠 ReturnURL 收結果，不可主動輪詢**；TradeStatus 0=受理、1=成功、10200163=失敗 | 非即時（審核） |
| 微信支付 | `WeiXin` | — | 即時 |
| 綠界 PAY | （依官方 53379 頁） | — | 即時 |

### 1.3 查詢訂單（QueryTradeInfo）

| 項目 | 內容 |
|------|------|
| 端點 | `/Cashier/QueryTradeInfo/V5`（POST，回應 URL-encoded 字串） |
| 用途 | 主動查詢單筆訂單付款狀態（收到回呼後的二次確認、漏回呼補救） |
| 相依性 | 需先有建單；以 MerchantTradeNo 查詢 |
| 關鍵參數 | TimeStamp（Unix 秒，**有效期 3 分鐘**）、CheckMacValue |
| 回應重點 | TradeStatus：`0`=訂單成立未付款、`1`=已付款、`10200095`=訂單未成立、`10200163`=BNPL 失敗 |
| 限制 | 呼叫過快回 HTTP 403 並鎖 30 分鐘；多筆查詢應改用對帳媒體檔 |
| 適用情境 | 信用卡/TWQR：付款後 10 分鐘查、TradeStatus=0 再隔 10 分鐘查（或付款後 40 分鐘一次查）；ATM/CVS/BARCODE/BNPL：**官方明示勿主動輪詢，等回呼** |

### 1.4 查詢信用卡單筆明細（QueryTrade/V2）

| 項目 | 內容 |
|------|------|
| 端點 | `/CreditDetail/QueryTrade/V2`（回應 JSON） |
| 用途 | 查詢信用卡交易的帳務明細（授權/關帳狀態等） |
| 適用情境 | 退款前確認帳務狀態（close_data 狀態決定 DoAction 動作路徑，見 `04-flows/05`） |

### 1.5 查詢 ATM/CVS/BARCODE 取號結果（QueryPaymentInfo）

| 項目 | 內容 |
|------|------|
| 端點 | `/Cashier/QueryPaymentInfo`（回應 URL-encoded） |
| 用途 | 主動查詢取號結果（虛擬帳號/繳費代碼/條碼），補救 PaymentInfoURL 漏收 |
| 適用情境 | 消費者回報「沒拿到繳費資訊」時的客服支援查詢 |

### 1.6 信用卡定期定額訂單查詢（QueryCreditCardPeriodInfo）

| 項目 | 內容 |
|------|------|
| 端點 | `/Cashier/QueryCreditCardPeriodInfo`（回應 JSON） |
| 用途 | 查詢定期定額合約與各期授權明細 |
| 適用情境 | 訂閱管理後台、每期授權狀態核對 |

### 1.7 信用卡請退款（DoAction）

| 項目 | 內容 |
|------|------|
| 端點 | `/CreditDetail/DoAction`（POST，回應 URL-encoded） |
| 用途 | 信用卡帳務操作：關帳（請款）C、退刷 R、取消關帳 E、放棄 N |
| 相依性 | 需 MerchantTradeNo＋TradeNo（綠界交易編號）雙識別；動作可用性取決於當前帳務狀態（見 `03-architecture/03-state-machines.md`） |
| 限制 | **僅信用卡**（ATM/CVS/BARCODE 無退款 API）；**測試環境不可用**（無實際授權環境）；每日 20:15–20:30 勿呼叫（自動關帳時段）；訂單 21 天內須完成關帳、逾 90 天系統自動放棄；分期與紅利折抵交易只能全額退刷；銀聯卡授權完成即自動關帳、「要關帳」狀態不可取消關帳；退刷需帳戶餘額足夠；不可用於停用定期定額 |
| 適用情境 | 出貨後請款、客訴退款、訂單取消釋放額度 |
| 注意事項 | `error_overDate` 錯誤需聯繫客服處理 |

### 1.8 信用卡定期定額訂單作業（CreditCardPeriodAction）

| 項目 | 內容 |
|------|------|
| 端點 | `/Cashier/CreditCardPeriodAction`（POST） |
| 用途 | `ReAuth`＝補授權最新一筆失敗交易；`Cancel`＝終止後續扣款。**僅此兩種動作，無暫停/啟用 API** |
| 限制 | ReAuth 限「最新一筆」授權失敗時；暫停或終止狀態下不可補授權；**終止不可逆**（要恢復只能建新合約）；ReAuth 於測試環境不可測；其他變更需登入廠商後台操作 |
| 適用情境 | 訂閱扣款失敗補救、使用者取消訂閱 |
| 注意事項 | 補授權結果由排程通知至 PeriodReturnURL，非同步 |

### 1.9 下載特店對帳媒體檔（TradeNoAio）

| 項目 | 內容 |
|------|------|
| 端點 | `/PaymentMedia/TradeNoAio` — **網域是 `vendor.ecpay.com.tw`，非 payment** |
| 用途 | 下載區間內全部交易的 CSV 對帳檔（每日對帳的主資料來源） |
| 關鍵參數 | DateType（2=付款日、4=撥款日、6=訂單日）、BeginDate/EndDate（yyyy-MM-dd）、MediaFormated（0=V1/1=V2/2=V3）、選填 PaymentType/PaymentStatus/AllocateStatus/CharSet |
| 限制 | **需在廠商後台預先設定允許 IP**；同 IP 每分鐘限下載一份；查無資料時僅回欄位列 |
| 適用情境 | 每日排程對帳（官方建議每日呼叫）；大量狀態核對（取代逐筆查詢） |
| 注意事項 | V3（2025/4 起）細分手續費率/手續費/處理費欄位；信用卡退款明細另見撥款對帳檔 |

### 1.10 下載信用卡撥款對帳檔（FundingReconDetail）

| 項目 | 內容 |
|------|------|
| 端點 | `/CreditDetail/FundingReconDetail`（`payment` 網域） |
| 用途 | 下載信用卡請/退款的撥款明細 CSV（結算金額、手續費、撥款金額） |
| 關鍵參數 | PayDateType（fund=結算日／close=關帳日／enter=撥款入帳日）、StartDate/EndDate |
| 限制 | **測試環境不可用**；銀行上班日 14:00 後才查得到；今日訂單需隔日 14:00 後可查；假日無撥款資訊 |
| 適用情境 | 財務層級的金流入帳核對（與銀行實際撥款比對）；退款金額以負數呈現 |

## 2. 站內付 2.0（AES-JSON，雙網域）

> Token 系列走 `ecpg.ecpay.com.tw`；查詢/請退款走 `ecpayment.ecpay.com.tw`。

| API | 端點（網域） | 用途 | 相依性／限制／注意 |
|-----|-------------|------|-------------------|
| 取得廠商驗證碼（付款） | `/Merchant/GetTokenbyTrade`（ecpg） | 以交易資料換取前端付款 Token | ConsumerInfo 物件與 Email/Phone 未填是 RtnCode≠1 最常見根因；Token 交給前端 JS SDK 使用 |
| 取得廠商驗證碼（會員） | `/Merchant/GetTokenbyUser`（ecpg） | 以會員識別換 Token（綁卡情境） | 需先有會員識別碼 |
| 建立交易 | `/Merchant/CreatePayment`（ecpg） | 前端完成輸入後，後端確認建立交易 | 回應含 `ThreeDInfo.ThreeDURL`（巢狀）時**必須**導向 3D 驗證頁，否則交易逾時失敗（2025/8 起幾乎必現）；ATM/CVS/BARCODE 回應含繳費資訊需顯示給消費者 |
| 綁定信用卡取 Token | `/Merchant/GetTokenbyBindingCard`（ecpg） | 綁卡流程起點 | 綁卡僅支援信用卡一次付清/分期 |
| 建立綁定信用卡 | `/Merchant/CreateBindCard`（ecpg） | 完成卡片綁定 | — |
| 以卡片 ID 建立交易 | `/Merchant/CreatePaymentWithCardID`（ecpg） | 用已綁卡片快速扣款 | 回頭客一鍵付款 |
| 查詢會員綁定卡 | `/Merchant/GetMemberBindCard`（ecpg） | 列出會員綁定卡片 | — |
| 刪除會員綁定卡 | `/Merchant/DeleteMemberBindCard`（ecpg） | 解除綁定 | 需先以 GetTokenbyUser 取得刪除用驗證碼（官方 9048 頁） |
| 查詢訂單 | `/1.0.0/Cashier/QueryTrade`（ecpayment） | 主動查詢交易狀態 | 定期定額查詢同端點、以參數區分 |
| 信用卡明細查詢 | `/1.0.0/CreditDetail/QueryTrade`（ecpayment） | 帳務明細 | — |
| 取號結果查詢 | `/1.0.0/Cashier/QueryPaymentInfo`（ecpayment） | ATM/CVS/BARCODE 取號結果 | — |
| 信用卡請退款 | `/1.0.0/Credit/DoAction`（ecpayment） | 同 AIO DoAction 語意 | 僅信用卡 |
| 定期定額作業 | `/1.0.0/Cashier/CreditCardPeriodAction`（ecpayment） | 補授權/終止 | 同 AIO 限制 |
| 撥款對帳下載 | `/1.0.0/Cashier/QueryTradeMedia`（ecpayment） | 對帳檔 | — |

**站內付 2.0 前端（WEB JS SDK）能力**：初始化（環境參數為字串 `'Stage'`/`'Prod'`）、取得付款畫面（容器 ID 固定 `ECPayPayment`）、取得付款代碼、設定語系、取得 Apple Pay 付款結果。前端需依序載入 jQuery → node-forge → 官方 SDK。Apple Pay 需先完成網域驗證＋Merchant ID 申請＋憑證上傳。

## 3. 信用卡幕後授權（AES-JSON，`ecpayment` 網域）

| API | 端點 | 用途 | 限制／注意 |
|-----|------|------|-----------|
| 信用卡卡號交易授權 | `/1.0.0/Cashier/BackAuth` | 特店後端直接送卡號授權 | **PCI SAQ-D 等級**；支援一次付清/紅利/分期/定期定額/銀聯 |
| 查詢訂單 | `/1.0.0/Cashier/QueryTrade` | 交易狀態查詢 | — |
| 查詢發卡行 | `/1.0.0/Cashier/QueryCardInfo` | 依卡號前綴查發卡行 | 幕後授權家族特有 |
| 信用卡明細查詢 | `/1.0.0/CreditDetail/QueryTrade` | 帳務明細 | — |
| 定期定額查詢／作業 | `/1.0.0/Cashier/QueryTrade`、`/1.0.0/Cashier/CreditCardPeriodAction` | 同 AIO 語意 | — |
| 信用卡請退款 | `/1.0.0/Credit/DoAction` | 同 AIO 語意 | 僅信用卡 |
| 撥款對帳下載 | `/1.0.0/Cashier/QueryTradeMedia` | 對帳檔 | — |

## 4. 非信用卡幕後取號（AES-JSON，`ecpayment` 網域）

| API | 端點 | 用途 | 限制／注意 |
|-----|------|------|-----------|
| 產生繳費代碼 | `/1.0.0/Cashier/GenPaymentCode` | 後台直接產生 ATM 虛擬帳號／超商代碼／條碼 | 繳費結果透過付款結果通知（JSON 回呼）送達 |
| 查詢訂單 | `/1.0.0/Cashier/QueryTrade` | 狀態查詢 | — |
| 取號結果查詢 | `/1.0.0/Cashier/QueryPaymentInfo` | 取號資訊查詢 | — |
| 查詢 CVS 三段式條碼 | `/1.0.0/Cashier/QueryCVSBarcode` | 條碼明細 | 幕後取號家族特有（官方 39086 頁） |

## 5. 回呼（Webhook）能力清單

> 回呼是綠界主動打向特店的通知，詳細設計見 `04-flows/02-webhook.md`。

| 回呼 | 所屬服務 | 格式 | 觸發時機 | 特店回應 | 重送機制 |
|------|---------|------|---------|---------|---------|
| ReturnURL 付款結果通知 | AIO | Form POST（CMV-SHA256；RtnCode 為**字串**） | 付款完成（超商條碼約完成後兩天） | 純文字 `1\|OK`（HTTP 200） | 未收到正確回應時每 5–15 分鐘重發、當天最多 4 次 |
| PaymentInfoURL 取號結果通知 | AIO | Form POST | ATM/CVS/BARCODE 取號完成 | `1\|OK` | 同上 |
| PeriodReturnURL 定期定額通知 | AIO | Form POST | 每期授權完成（含補授權排程結果） | `1\|OK` | 同上 |
| 無卡分期申請結果通知 | AIO（BNPL） | Form POST | BNPL 審核結果 | `1\|OK` | 同上 |
| OrderResultURL | AIO | 前端 Form POST 導轉 | 付款完成後導回消費者瀏覽器 | HTML 結果頁（**非** `1\|OK`） | 不重送；與 ReturnURL 無固定先後順序 |
| ReturnURL | 站內付 2.0／幕後授權／幕後取號 | JSON POST（AES；RtnCode 為**整數**） | 付款/授權/繳費完成 | 純文字 `1\|OK` | 重試間隔與次數：**官方未說明**（AIO 之 4 次規則不必然適用） |
| OrderResultURL | 站內付 2.0 | Form POST，`ResultData` 欄位內含 JSON | 前端導轉 | HTML 結果頁 | 不重送 |

## 6. 附錄型能力（官方文件提供的參照資料）

| 資料 | 官方頁 | 架構上的用途 |
|------|--------|-------------|
| 檢查碼機制說明 | 2902 | 簽章模組的規格來源（見 `03-architecture/04-security.md`） |
| URLEncode 轉換表 | 2904 | 簽章模組 .NET 字元還原表 |
| 付款方式一覽表／回覆付款方式一覽表 | 5679／5686 | 送出值與回傳值**不同**（如送 `Credit`、回 `Credit_CreditCard`），需建立對照表資料 |
| 交易狀態代碼表 | 5740 | 錯誤處理模組的代碼字典 |
| 銀行代碼表 | 44089 | ATM 顯示繳費銀行名稱 |
| ATM 檢核功能表 | 59297 | ATM 付款人帳號檢核設定 |
| 自行檢測表 | 5735 | 上線前自檢（納入 `05-testing/04`） |
