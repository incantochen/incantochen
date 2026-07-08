# 05-2. 測試案例（Test Cases）

> 涵蓋任務要求的四組案例：各 API 功能測試、Webhook 冪等性測試、CheckMacValue 驗證測試、主動對帳測試。
> 案例格式統一：**編號｜前置｜動作｜預期**。層級標示：U=Unit、I=Integration（假綠界）、E=E2E（sandbox）、P=Production 驗收。

## 1. 各 API 功能測試案例

### 1.1 產生訂單（AioCheckOut）

| 編號 | 層 | 前置 | 動作 | 預期 |
|------|:--:|------|------|------|
| PAY-01 | E | 有效測試帳號 | 信用卡建單並以測試卡完成付款 | 導轉綠界頁金額/品名正確；ReturnURL 收到 RtnCode='1' 且 MerchantTradeNo 一致 |
| PAY-02 | E | 同上 | ATM 建單並取號 | PaymentInfoURL 收到 RtnCode='2'＋BankCode/vAccount/ExpireDate |
| PAY-03 | E | 同上 | CVS 建單並取號 | PaymentInfoURL 收到 RtnCode='10100073'＋PaymentNo |
| PAY-04 | U | — | MerchantTradeNo 21 字元/含符號/含中文 | 送出前被本地檢核拒絕 |
| PAY-05 | U | — | 金額 0／負數／小數 | 本地檢核拒絕 |
| PAY-06 | I | 已建單 | 以相同 MerchantTradeNo 再建單 | 本地 UNIQUE 擋下；若繞過則綠界回 10200047 |
| PAY-07 | U | 主機時區設為 UTC | 產生 MerchantTradeDate | 輸出為 UTC+8 |
| PAY-08 | U | — | ItemName 中文 450 字元 | 先截斷至安全長度再簽章；簽章與送出內容一致 |
| PAY-09 | E | — | ItemName 含 `curl` 等 WAF 關鍵字 | 本地消毒擋下（否則綠界 10400011） |
| PAY-10 | U | — | 定期定額參數組合越界（Frequency=0／ExecTimes=1／Y 頻率≠1） | 本地檢核拒絕 |
| PAY-11 | U | — | BNPL 金額 2,999 | 本地檢核拒絕（門檻 3,000） |

### 1.2 站內付 2.0

| 編號 | 層 | 動作 | 預期 |
|------|:--:|------|------|
| PG-01 | E | GetTokenbyTrade（完整 ConsumerInfo） | TransCode=1 且 RtnCode=1（整數），Token 非空 |
| PG-02 | E | GetTokenbyTrade 缺 ConsumerInfo | RtnCode≠1（已知最常見失敗根因的回歸防護） |
| PG-03 | E | CreatePayment 測試卡 | 回應含 ThreeDInfo.ThreeDURL（巢狀路徑）→ 前端導向 3D → 完成後 ReturnURL 到達 |
| PG-04 | I | 查詢 API 打到 ecpg 網域（故意打錯） | 傳輸模組路由測試：正確路由到 ecpayment；繞過路由層則 404（防迴歸） |
| PG-05 | I | OrderResultURL 收 Form POST | 從 `ResultData` 欄位解析（非 JSON body）→ AES 解密成功 |
| PG-06 | E | ATM via 站內付 | CreatePayment 回應即含繳費資訊；ReturnURL 於模擬繳費後非同步到達 |

### 1.3 查詢（QueryTradeInfo 等）

| 編號 | 層 | 動作 | 預期 |
|------|:--:|------|------|
| QRY-01 | E | 已付款訂單查詢 | TradeStatus='1'，金額/編號一致，CheckMacValue 驗證通過 |
| QRY-02 | E | 未付款訂單查詢 | TradeStatus='0'，不觸發任何狀態轉移副作用 |
| QRY-03 | U | TimeStamp 超過 3 分鐘 | 本地即時產生機制保證不逾時；模擬逾時請求被綠界拒絕的處理路徑 |
| QRY-04 | I | 模擬 403 | 熔斷 30 分鐘＋告警；期間查詢排程暫停 |
| QRY-05 | I | 查詢結果與本地皆 paid | 冪等：只記 log，無重複副作用 |

### 1.4 退款（DoAction）——測試環境不可用，以 I＋P 覆蓋

| 編號 | 層 | 前置 | 動作 | 預期 |
|------|:--:|------|------|------|
| REF-01 | U | — | 決策表全組合（4 帳務狀態 × 全額/部分 × 一般/分期/紅利/銀聯） | 輸出正確動作序列或明確拒絕 |
| REF-02 | U | — | PaymentType 非信用卡類 | 拒絕並導向人工流程 |
| REF-03 | I | 假綠界 | 「要關帳」全額退：E→N 兩步 | 兩步序列正確；任一步失敗即中止並告警 |
| REF-04 | I | 假綠界回 error_overDate | 執行退刷 | 標記 failed＋提示聯繫客服 |
| REF-05 | U | 系統時間 20:20 | 發起 DoAction | 排程延後（避開 20:15–20:30） |
| REF-06 | P | 正式環境小額已付款訂單 | 全額退款 | RtnCode=1；次期撥款對帳檔出現負數退款 |

### 1.5 定期定額

| 編號 | 層 | 動作 | 預期 |
|------|:--:|------|------|
| SUB-01 | E | 建立定期定額合約（測試卡） | 首期 ReturnURL 到達；本地合約 active |
| SUB-02 | I | 模擬 PeriodReturnURL 第 N 期通知 | 該期落庫一次；TotalSuccessTimes 與本地累計一致 |
| SUB-03 | I | 模擬累計欄位與本地不符 | 告警（漏期偵測） |
| SUB-04 | I | 模擬連續 6 期失敗 | 本地合約轉 auto_cancelled＋通知用戶 |
| SUB-05 | E | Cancel 終止 | RtnCode=1；本地 terminated；再 ReAuth 應被拒 |
| SUB-06 | U | 停扣需求誤走 DoAction | 本地擋下（官方明示 DoAction 不支援停用定期定額） |

### 1.6 發票（B2C）

| 編號 | 層 | 動作 | 預期 |
|------|:--:|------|------|
| INV-01 | E | 付款完成→自動開立 | TransCode=1 且 RtnCode=1；InvoiceNo 10 碼回填 |
| INV-02 | U | 統編＋捐贈同時存在 | 本地互斥檢核拒絕 |
| INV-03 | U | ItemAmount 加總 ≠ SalesAmount（含混稅） | 本地檢核拒絕 |
| INV-04 | I | RelateNumber 重複開立（回呼重送誘發） | 冪等：不產生第二張發票 |
| INV-05 | E | 全額退款→作廢 | Invalid 成功；已有折讓的發票先作廢折讓單 |
| INV-06 | E | 部分退款→折讓 | Allowance 金額=退款額 |
| INV-07 | U | 作廢時限（奇數月 13 日後作廢前兩月發票） | 決策改走全額折讓 |

## 2. Webhook 冪等性測試案例（核心）

| 編號 | 層 | 場景 | 預期 |
|------|:--:|------|------|
| IDM-01 | I | 同一 ReturnURL 通知連續重送 4 次 | 4 筆 WEBHOOK_EVENT；狀態轉移 1 次；出貨/發信副作用 1 次 |
| IDM-02 | I | 兩個相同通知**同時**到達（併發） | 條件式 UPDATE 僅一邊受影響列數=1；另一邊走重送分支 |
| IDM-03 | I | 先收 OrderResultURL 後收 ReturnURL（及相反順序） | 兩種順序最終狀態相同；結果頁不直接採信前端 POST |
| IDM-04 | I | PaymentInfoURL 重送 | 繳費資訊 upsert，不產生重複紀錄 |
| IDM-05 | I | 已 paid 後又收到 RtnCode≠1 的通知 | 吸收態不回退；記 event＋告警 |
| IDM-06 | I | SimulatePaid=1 重送 | 狀態可更新、副作用永不觸發 |
| IDM-07 | I | 回呼處理中 Worker 當機重啟 | 佇列 at-least-once 重投；Worker 冪等不重複出貨 |
| IDM-08 | I | 回應了錯誤格式（`"1|OK"` 含引號） | 模擬器判定失敗並重送——驗證我們的回應產生器永遠輸出精確 `1\|OK`＋HTTP 200 |
| IDM-09 | I | 查詢補救與回呼同時寫入同一訂單 | 單一轉移路徑保證只成功一次 |
| IDM-10 | I | PeriodReturnURL 同期通知重送 | 該期 PERIOD_EXECUTION 僅一筆 |

## 3. CheckMacValue 驗證測試案例

| 編號 | 層 | 場景 | 預期 |
|------|:--:|------|------|
| CMV-01 | U | 官方測試向量全數 | 產生值與官方預期完全一致 |
| CMV-02 | U | 參數含空格/`~`/`()!*.-_`/中文/`&`/`<` | 與官方 URLEncode 轉換表一致 |
| CMV-03 | U | 參數排序（大小寫、數字開頭、相同前綴） | A–Z 字典序正確 |
| CMV-04 | U | 驗證：篡改任一參數值 | 驗證失敗 |
| CMV-05 | U | 驗證：CheckMacValue 大小寫變造/截斷/空值 | 驗證失敗 |
| CMV-06 | U | timing-safe：不同長度/首字元即不同的輸入 | 使用 timing-safe 函式（以實作審查＋介面測試把關） |
| CMV-07 | U | NeedExtraPaidInfo=Y 的額外欄位 | 全欄位納入計算；漏一欄即失敗（防迴歸） |
| CMV-08 | U | 以 `aesUrlEncode` 誤算 CMV | 必定不符（防兩套 encode 混用的迴歸案例） |
| CMV-09 | I | 回呼帶正確 CMV 但金鑰配置錯誤（拿發票金鑰驗金流） | 驗證失敗＋告警（帳號混用偵測） |
| CMV-10 | U | AES 測試向量（官方）加解密往返 | 一致；URL-safe Base64 輸入被拒 |

## 4. 主動對帳測試案例

| 編號 | 層 | 場景 | 預期 |
|------|:--:|------|------|
| REC-01 | U | 解析 V1/V2/V3 三種格式樣本檔 | 欄位映射正確（V3 手續費細分欄位） |
| REC-02 | U | Big5 與 UTF8 編碼樣本 | 中文欄位（品名/姓名）不亂碼 |
| REC-03 | U | 空檔（僅欄位列） | 判定「查無資料」而非錯誤 |
| REC-04 | U | 備註欄含錯誤訊息 | 正確擷取並標記該列 |
| REC-05 | I | 檔內有、本地無（漏回呼） | missing_local→觸發補查詢→重建→重跑比對後 matched |
| REC-06 | I | 本地有、檔內無 | missing_remote→主動查詢確認未付款/日期區間錯位 |
| REC-07 | I | 金額不符 | amount_mismatch→凍結＋告警；**不自動改帳** |
| REC-08 | I | 退款交易的媒體檔呈現 | 退款日期/金額欄位正確歸戶到原訂單 |
| REC-09 | I | 定期定額多期交易 | 各期正確歸戶到同一合約 |
| REC-10 | I | 下載節流 | 相鄰請求 ≥1 分鐘；排程不並發下載 |
| REC-11 | E | sandbox 完成一筆付款後下載媒體檔（DateType=2） | 該筆交易出現且金額一致 |
| REC-12 | P | 上線首日對帳 | 差異=0；手續費與費率合約相符 |
| REC-13 | U | 撥款對帳檔樣本（fund/close/enter 三維度） | 解析正確；退款為負數 |
