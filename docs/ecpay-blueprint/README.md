# ECPay Architecture Blueprint（綠界金流架構藍圖）

> 版本：1.0 ｜ 建立日期：2026-07-07
> 依據：ECPay Developers 官方技術文件（https://developers.ecpay.com.tw/2509/ 及金流相關文件家族）
> 性質：**與專案無關的可重用架構規劃**，可直接套用於任何電商專案。不含任何可執行程式碼。

---

## 1. 本藍圖是什麼

這是一份以 ECPay 官方技術文件為唯一依據、面向**大型商業專案長期維護**的金流架構規劃文件集，涵蓋：

- ECPay 全部金流相關 API 的能力盤點（不限於單一專案需要的子集）
- 可重複使用的模組劃分、資料模型、狀態機與安全設計
- Payment／Webhook／Query／Reconcile／Refund／Subscription／Invoice／Error Handling 完整流程
- 完整測試藍圖（Unit／Integration／E2E／冪等性／CheckMacValue／對帳／Sandbox／上線／回歸）

**資訊誠實原則**：所有內容以官方文件為準；官方文件未提供的資訊一律標示「**官方未說明**」，不自行推測補充。

## 2. 文件樹（Document Tree）

```
docs/ecpay-blueprint/
├── README.md                          ← 本檔：總覽、文件樹、設計理由、閱讀路徑
├── 00-scope-and-sources.md            ← 範圍界定、官方文件來源對照表、資訊標示原則
├── 01-service-landscape.md            ← 金流服務全景：服務家族、合約模式、協議模式、環境與網域
├── 02-api-capability-matrix.md        ← API 能力對照矩陣（用途/流程/相依/限制/適用情境/注意事項）
├── 03-architecture/
│   ├── 01-module-design.md            ← 系統架構與模組劃分、目錄結構建議、設計理由
│   ├── 02-data-model.md               ← 資料模型（ER Diagram）：交易/回呼事件/退款/對帳/定期定額
│   ├── 03-state-machines.md           ← 狀態機（State Diagram）：付款/信用卡帳務/退款/定期定額
│   └── 04-security.md                 ← 安全設計：CheckMacValue 偽代碼、AES 協議、金鑰管理、PCI 範圍
├── 04-flows/
│   ├── 01-payment-flows.md            ← 付款流程（Sequence Diagram）：即時付款/二段式取號付款/導轉 vs 嵌入
│   ├── 02-webhook.md                  ← Webhook（ReturnURL/PaymentInfoURL/PeriodReturnURL）：驗章、冪等、重送、佇列
│   ├── 03-query.md                    ← 主動查詢策略：查詢 API 家族、輪詢節奏、限流退避
│   ├── 04-reconciliation.md           ← 對帳：特店對帳媒體檔/信用卡撥款對帳檔、每日對帳流程、差異處理
│   ├── 05-refund.md                   ← 退款：DoAction 四動作（C/R/E/N）、非信用卡限制、補償流程
│   ├── 06-subscription.md             ← 定期定額（訂閱）：建立/通知/補授權/終止
│   ├── 07-invoice.md                  ← 電子發票（官方支援，獨立 API 家族）：與金流的整合觸點
│   └── 08-error-handling.md           ← 錯誤處理：錯誤分類、雙層檢查、限流 403、降級策略
└── 05-testing/
    ├── 01-test-strategy.md            ← 測試策略總綱 + Unit/Integration/E2E 測試規劃
    ├── 02-test-cases.md               ← 各 API 功能測試案例、Webhook 冪等性測試、CheckMacValue 驗證測試、主動對帳測試
    ├── 03-sandbox-plan.md             ← Sandbox 測試規劃：測試帳號、測試卡號、模擬付款、本機回呼
    └── 04-golive-and-regression.md    ← Production 上線檢查清單 + Regression Test 規劃
```

## 3. 文件架構設計理由

| 設計決策 | 理由 |
|---------|------|
| **四層結構：全景 → 能力矩陣 → 架構 → 流程 → 測試** | 對應讀者角色：決策者讀 01（選型）、架構師讀 02/03（設計）、開發者讀 04（實作流程）、QA 讀 05（驗證）。每層可獨立更新，不互相牽連。 |
| **能力矩陣（02）獨立成檔** | API 清單是最常隨官方改版變動的部分，集中一處便於定期比對官方「更新歷程」頁維護。 |
| **架構（03）與流程（04）分離** | 架構是「靜態設計」（模組、資料、狀態、安全），流程是「動態行為」（時序、重試、補償）。混在一起會讓改一個流程動到整份架構文件。 |
| **每個核心流程一檔（04-flows/）** | Payment/Webhook/Query/Reconcile/Refund/Subscription/Invoice/Error 是任務要求的完整流程清單，一流程一檔對應日後「一個功能一個 PR」的維護粒度。 |
| **測試藍圖（05）拆四檔而非十檔** | 任務要求的 10 個測試主題中，「策略＋三層測試規劃」屬同一份決策文件；「四類測試案例」共用同一套案例表格式；Sandbox 與上線/回歸各自獨立成檔，因為它們的更新時機不同（Sandbox 隨官方測試帳號變動、上線清單隨每次 release 演進）。 |
| **編號前綴（00-05）** | 保證檔案總管與 Git 上的排序即為建議閱讀順序。 |
| **模組命名與內文詞彙統一採官方中文詞彙** | 例如「特店（Merchant）」「檢查碼（CheckMacValue）」「請款（關帳）」，避免團隊自創詞彙與官方文件對不上。 |

## 4. 建議閱讀路徑

| 你是誰 | 讀什麼 |
|--------|--------|
| 第一次接觸 ECPay | `01-service-landscape.md` → `02-api-capability-matrix.md` |
| 要設計系統 | `03-architecture/` 全部 → `04-flows/01`、`04-flows/02` |
| 要實作某個流程 | `04-flows/` 對應章節 ＋ `03-architecture/04-security.md` |
| 要驗證與上線 | `05-testing/` 全部 |
| 要維護本藍圖 | `00-scope-and-sources.md`（來源對照）＋官方「更新歷程」頁 |

## 5. 維護原則

1. **以官方文件為準**：每次 ECPay 官方發布更新（各文件的「更新歷程」頁），優先更新 `02-api-capability-matrix.md`，再檢查受影響的流程文件。
2. **不寫程式實作**：本藍圖永遠停留在架構層（結構、圖、偽代碼），程式實作屬於各專案 repository。
3. **「官方未說明」標示不可刪除**：若日後官方補充了說明，以引用官方頁面 URL 的方式更新，並移除標示。
4. **圖優先於文**：流程一律以 Mermaid（sequence/state/flow/ER）表達，文字僅補充圖無法承載的約束條件。
