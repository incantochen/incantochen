# 00. 範圍界定與官方文件來源對照

> 本藍圖所有內容的依據清單。維護本藍圖時，先核對本檔列出的官方頁面是否有異動。

## 1. 範圍界定

### 1.1 納入範圍（金流相關）

| 服務 | 官方文件 | 說明 |
|------|---------|------|
| **全方位金流 AIO** | https://developers.ecpay.com.tw/2509/ | 本藍圖主軸。導轉式付款頁，涵蓋信用卡（一次付清/分期/定期定額/紅利）、ATM、超商代碼/條碼、WebATM、Apple Pay、TWQR、微信支付、BNPL、綠界 PAY |
| **站內付 2.0（Web/App）** | 官方「站內付 2.0」技術文件（簡介頁 8972） | ECPG 線上金流閘道服務之一；嵌入式付款、綁定信用卡 |
| **信用卡幕後授權** | 官方「信用卡幕後授權」技術文件（簡介頁 45876） | 純後台信用卡授權（需最高等級 PCI 合規） |
| **非信用卡幕後取號** | 官方「非信用卡幕後取號」技術文件（簡介頁 27950） | 純後台產生 ATM 虛擬帳號/超商代碼/條碼 |
| **對帳檔下載** | AIO 文件「下載檔案」章節（2896、2898） | 特店對帳媒體檔＋信用卡撥款對帳檔 |
| **電子發票（B2C/B2B）** | 官方電子發票技術文件（einvoice 家族） | 官方支援。屬獨立 API 家族，本藍圖涵蓋其與金流的整合觸點與能力盤點（詳見 `04-flows/07-invoice.md`） |
| **定期定額（Subscription）** | AIO 文件 2868/5631/2892/2900；ECPG 對應章節 | 官方支援，含建立、通知、查詢、補授權/終止 |

### 1.2 提及但不展開（非金流或特殊通路）

以下為官方文件存在、但性質屬特殊通路或非金流的服務，本藍圖僅在服務全景（01）中定位，不展開流程設計：

- **POS 刷卡機**（線下金流，專用 POS 協定）
- **直播收款**（特殊收款通路）
- **Shopify 專用金流**（購物車平台模組）
- **物流**（logistics 家族）、**ECTicket**（票證）、**電子收據**（receipt 家族）——非金流，僅在跨服務整合處提及

### 1.3 官方不支援的能力（明確標示，避免誤設計）

| 能力 | 官方狀態 |
|------|---------|
| 非新台幣幣別 | 不支援（僅 TWD） |
| 分帳（Split Payment） | 無此 API，需應用層自行拆帳 |
| 非信用卡（ATM/超商代碼/條碼）線上退款 API | 不支援；需透過綠界廠商後台或客服人工處理 |
| Chargeback（爭議款）查詢/回應 API | 無此 API；爭議處理透過綠界後台與 Email 進行 |
| 同時啟用多組 HashKey/HashIV | 不支援；金鑰輪換需停機切換 |
| iframe 嵌入綠界付款頁 | 明確禁止（會導致交易失敗） |

## 2. 官方文件來源對照表（AIO 2509 文件家族）

> 下列 URL 為 developers.ecpay.com.tw 官方頁面。頁面編號即官方文件系統的頁面 ID。

### 2.1 AIO 全方位金流（本次完整閱讀之主文件）

| 章節 | URL |
|------|-----|
| 簡介 | https://developers.ecpay.com.tw/2509.md |
| 重要詞彙說明 | https://developers.ecpay.com.tw/2853.md |
| 更新歷程 | https://developers.ecpay.com.tw/35196.md |
| 測試介接資訊 | https://developers.ecpay.com.tw/2856.md |
| 介接注意事項 | https://developers.ecpay.com.tw/2858.md |
| 付款簡介 | https://developers.ecpay.com.tw/2860.md |
| 產生訂單 | https://developers.ecpay.com.tw/2862.md |
| 全方位金流付款 | https://developers.ecpay.com.tw/2864.md |
| 信用卡一次付清 | https://developers.ecpay.com.tw/2866.md |
| 信用卡定期定額 | https://developers.ecpay.com.tw/2868.md |
| 信用卡分期付款 | https://developers.ecpay.com.tw/2870.md |
| 消費者自費分期 | https://developers.ecpay.com.tw/41284.md |
| Apple Pay 付款 | https://developers.ecpay.com.tw/7328.md |
| ATM 虛擬帳號付款 | https://developers.ecpay.com.tw/2872.md |
| 超商代碼 | https://developers.ecpay.com.tw/2874.md |
| 超商條碼 | https://developers.ecpay.com.tw/2876.md |
| WebATM | https://developers.ecpay.com.tw/11031.md |
| 歐付寶 TWQR 行動支付 | https://developers.ecpay.com.tw/36991.md |
| BNPL 無卡分期 | https://developers.ecpay.com.tw/36659.md |
| 微信支付 | https://developers.ecpay.com.tw/56448.md |
| 綠界 PAY 付款 | https://developers.ecpay.com.tw/53379.md |
| 付款結果通知（ReturnURL） | https://developers.ecpay.com.tw/2878.md |
| 定期定額付款結果通知 | https://developers.ecpay.com.tw/5631.md |
| 取號結果通知（PaymentInfoURL） | https://developers.ecpay.com.tw/2881.md |
| 無卡分期申請結果通知 | https://developers.ecpay.com.tw/37517.md |
| 額外回傳的參數 | https://developers.ecpay.com.tw/5675.md |
| 信用卡請款與退款簡介 | https://developers.ecpay.com.tw/2883.md |
| 信用卡請退款功能（DoAction） | https://developers.ecpay.com.tw/2885.md |
| 查詢訂單簡介 | https://developers.ecpay.com.tw/2887.md |
| 查詢訂單（QueryTradeInfo） | https://developers.ecpay.com.tw/2890.md |
| 信用卡定期定額訂單查詢 | https://developers.ecpay.com.tw/2892.md |
| 查詢信用卡單筆明細 | https://developers.ecpay.com.tw/2894.md |
| 查詢 ATM/CVS/BARCODE 取號結果 | https://developers.ecpay.com.tw/5615.md |
| 下載特店對帳媒體檔 | https://developers.ecpay.com.tw/2896.md |
| 下載信用卡撥款對帳檔 | https://developers.ecpay.com.tw/2898.md |
| 信用卡定期定額訂單作業 | https://developers.ecpay.com.tw/2900.md |
| 檢查碼機制說明 | https://developers.ecpay.com.tw/2902.md |
| URLEncode 轉換表 | https://developers.ecpay.com.tw/2904.md |
| 回覆付款方式一覽表 | https://developers.ecpay.com.tw/5686.md |
| 付款方式一覽表 | https://developers.ecpay.com.tw/5679.md |
| 交易狀態代碼表 | https://developers.ecpay.com.tw/5740.md |
| 自行檢測表 | https://developers.ecpay.com.tw/5735.md |
| 銀行代碼表 | https://developers.ecpay.com.tw/44089.md |
| ATM 檢核功能表 | https://developers.ecpay.com.tw/59297.md |
| 常見技術 FAQ | https://developers.ecpay.com.tw/61944.md |

### 2.2 其他金流文件家族（入口頁）

| 文件 | 入口 URL |
|------|---------|
| 站內付 2.0（Web）簡介 | https://developers.ecpay.com.tw/8972.md |
| 站內付 2.0（Web）介接注意事項 | https://developers.ecpay.com.tw/8987.md |
| 站內付 2.0（Web）建立交易 | https://developers.ecpay.com.tw/9053.md |
| 站內付 2.0（Web）ReturnURL | https://developers.ecpay.com.tw/9058.md |
| 站內付 2.0（Web）請退款 | https://developers.ecpay.com.tw/9073.md |
| 站內付 2.0（Web）查詢訂單 | https://developers.ecpay.com.tw/9083.md |
| 站內付 2.0（Web）下載撥款對帳檔 | https://developers.ecpay.com.tw/16406.md |
| 站內付 2.0（Web）參數加密方式 | https://developers.ecpay.com.tw/9103.md |
| 信用卡幕後授權簡介 | https://developers.ecpay.com.tw/45876.md |
| 信用卡幕後授權介接注意事項 | https://developers.ecpay.com.tw/45901.md |
| 信用卡卡號交易授權 | https://developers.ecpay.com.tw/45958.md |
| 幕後授權 ReturnURL | https://developers.ecpay.com.tw/45907.md |
| 非信用卡幕後取號簡介 | https://developers.ecpay.com.tw/27950.md |
| 幕後取號介接注意事項 | https://developers.ecpay.com.tw/27984.md |
| 幕後取號付款結果通知 | https://developers.ecpay.com.tw/28010.md |
| B2C 電子發票介接注意事項 | https://developers.ecpay.com.tw/7854.md |
| B2B 電子發票（存證模式）介接注意事項 | https://developers.ecpay.com.tw/24176.md |

## 3. 資訊標示原則

| 標示 | 意義 |
|------|------|
| （無標示） | 直接取自官方文件內容 |
| **官方未說明** | 官方文件未提供此資訊；本藍圖不推測，設計時應向綠界客服（02-2655-1775 / techsupport@ecpay.com.tw）確認 |
| **社群觀察值** | 非官方公開數值，僅作為保守初始值（例如 API 呼叫間隔建議），實際以測試為準 |

### 本藍圖中已知的「官方未說明」清單（集中列出）

1. **API 速率限制的具體數值**：官方僅說明過快呼叫會回 HTTP 403、需等約 30 分鐘恢復，未公開速率門檻。
2. **站內付 2.0／幕後授權 Callback 的重試次數上限**：官方未公開（AIO 為每 5–15 分鐘重送、當日最多 4 次，有明確說明）。
3. **綠界 Callback 來源 IP 清單**：不在公開文件中，需向客服索取。
4. **特店對帳媒體檔與撥款對帳檔的欄位級差異比較**：官方文件未提供逐欄比較，僅分別定義各自格式。
5. **Chargeback 爭議處理的時限與扣款機制細節**：無公開 API 文件，需洽客服。
