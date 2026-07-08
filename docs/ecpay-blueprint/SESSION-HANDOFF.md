# Session Handoff

> ✅ **任務已於 2026-07-07 全數完成**：文件樹規劃的 19 份文件（README ＋ 00–05 全部章節）均已產出於 docs/ecpay-blueprint/。
> 本檔保留作為任務歷程紀錄；下方內容為第一輪 Session 結束時的交接狀態（當時完成 13/19），僅供追溯，勿再依其執行。

## 1. 任務背景

- **本次任務目標**：依據 ECPay Developers 官方技術文件（https://developers.ecpay.com.tw/2509/），建立一份可供未來任何電商專案直接套用的「ECPay Architecture Blueprint」（架構藍圖，非目前專案的實作）。
- **原始需求重點**：
  - 完整分析官方文件所有金流相關能力（不限目前專案需要的子集）
  - 建立可長期維護、可擴充、可重複使用的架構規劃
  - 建立 API 能力對照矩陣（用途/流程/相依/限制/適用情境/注意事項）
  - 規劃完整流程：Payment／Webhook／Query／Reconcile／Refund／Invoice／Subscription／Error Handling
  - 規劃完整測試藍圖：測試策略、Unit/Integration/E2E、各 API 測試案例、Webhook 冪等性測試、CheckMacValue 驗證測試、主動對帳測試、Sandbox 測試規劃、Production 上線檢查清單、Regression Test 規劃
  - 全程繁體中文；**不得產生任何可執行程式碼**（僅允許：檔案結構、Mermaid 圖、CheckMacValue 演算法偽代碼）
  - 官方文件未提供的資訊須明確標示「官方未說明」，不得自行推測
  - 先產出完整文件樹，再依序產出各文件內容
- **執行範圍**：僅金流（Payment）相關 API；物流/發票/ECTicket 等鄰接服務僅在能力全景中定位、不展開流程設計（發票因任務明確要求需涵蓋，已納入文件樹但**尚未撰寫內容**）
- **文件存放位置確認**：**docs/ecpay-blueprint/**（唯一存放位置，不得存放於其他目錄，已確認遵守）

## 2. 本輪已完成事項

### 已完成的分析（透過 ecpay skill + web_fetch 官方頁面即時查證）

- 讀取本機 `.claude/skills/ecpay` 官方知識庫（SKILL.md、references/ 索引、guides/19、guides/22、guides/16）
- WebFetch 即時查證官方頁面：簡介(2509)、產生訂單(2862)、付款結果通知(2878)、信用卡請退款(2885)、查詢訂單(2890)、對帳媒體檔(2896)、信用卡撥款對帳檔(2898)、定期定額訂單作業(2900)、信用卡定期定額(2868)、CheckMacValue機制(2902)、取號結果通知(2881)、介接注意事項(2858)
- 盤點站內付2.0、信用卡幕後授權、非信用卡幕後取號三個 references 索引檔的完整端點清單

### 已建立的 Markdown 文件（共 13 份，全數位於 docs/ecpay-blueprint/）

```
docs/ecpay-blueprint/
├── README.md                          ✅ 完成（總覽、文件樹、設計理由、閱讀路徑、維護原則）
├── 00-scope-and-sources.md            ✅ 完成（範圍界定、官方文件來源URL對照表、資訊標示原則、已知「官方未說明」清單）
├── 01-service-landscape.md            ✅ 完成（服務家族全景圖、兩種合約模式、協議模式、環境網域拓撲、付款方式支援矩陣、選型決策樹、全域硬性約束）
├── 02-api-capability-matrix.md        ✅ 完成（AIO/站內付2.0/幕後授權/幕後取號 全部API的能力矩陣、回呼清單、附錄型能力）
├── 03-architecture/
│   ├── 01-module-design.md            ✅ 完成（模組全景圖、模組責任表、目錄結構建議、依賴方向規則、部署形態考量）
│   ├── 02-data-model.md               ✅ 完成（ER Diagram：Order/PaymentAttempt/WebhookEvent/Refund/Period/Recon/Invoice、唯一性約束、欄位取捨理由）
│   ├── 03-state-machines.md           ✅ 完成（付款狀態機、信用卡帳務狀態機、退款請求狀態機、定期定額合約狀態機、對帳比對結果狀態機）
│   └── 04-security.md                 ✅ 完成（CheckMacValue完整偽代碼、AES-JSON協議、金鑰管理、回呼端點防護、PCI DSS範圍）
├── 04-flows/
│   ├── 01-payment-flows.md            ✅ 完成（AIO即時付款/取號付款二段式/BNPL/站內付2.0/綁卡/幕後授權取號 Sequence Diagram）
│   ├── 02-webhook.md                  ✅ 完成（回呼端點清單、標準接收流程、冪等設計核心規則、佇列化架構、漏收恢復策略）
│   ├── 03-query.md                    ✅ 完成（查詢API家族對照、官方查詢節奏規則、技術約束、結果採用規則）
│   ├── 04-reconciliation.md           ✅ 完成（兩種對帳檔比較、每日交易對帳流程、資金對帳流程、三道防線總圖、監控指標）
│   └── 05-refund.md                   ✅ 完成（適用範圍判斷、DoAction四動作決策表+Sequence Diagram、硬性限制、業務層補償設計）
```

### 重要決策（已定案，勿重新討論）

1. **文件架構**：四層結構（全景→能力矩陣→架構→流程→測試），編號 00-05 前綴保證閱讀順序
2. **04-flows/ 拆分方式**：一流程一檔（Payment/Webhook/Query/Reconcile/Refund/Subscription/Invoice/Error），已完成前 5 個
3. **05-testing/ 拆分方式**：已規劃但**尚未撰寫**，決定拆為 4 檔（非任務要求的 10 檔）：
   - `01-test-strategy.md`（策略總綱＋Unit/Integration/E2E規劃）
   - `02-test-cases.md`（各API測試案例＋Webhook冪等性測試＋CheckMacValue驗證測試＋主動對帳測試，共用同一套案例表格式）
   - `03-sandbox-plan.md`（Sandbox測試規劃：測試帳號/測試卡號/模擬付款/本機回呼）
   - `04-golive-and-regression.md`（Production上線檢查清單＋Regression Test規劃）
4. **CheckMacValue 演算法**：僅偽代碼形式（已在 04-security.md 完成），未違反「不得產生可執行程式碼」限制
5. **模組命名統一採官方中文詞彙**（特店、檢查碼、請款/關帳等），避免自創詞彙與官方文件對不上

## 3. 目前執行狀態

- **階段**：文件樹的 §1、§2、§3（架構）、§4（流程 1-5/8）已完成；**§4 流程 6-8（Subscription/Invoice/Error Handling）尚未撰寫**；**§5 測試藍圖（全部 4 檔）尚未撰寫**
- **已完成比例**：約 60%（13 份文件中，架構層完全到位；流程層完成 5/8；測試層 0/4）
- **下一個應接續的位置**：`docs/ecpay-blueprint/04-flows/06-subscription.md`

## 4. 尚未完成事項

### 未完成的文件（依文件樹規劃，尚未建立）

- `docs/ecpay-blueprint/04-flows/06-subscription.md` — 定期定額（訂閱）流程：建立/通知/補授權/終止（Sequence Diagram）
  - 素材已在對話中蒐集完成：guides 已讀取 2868（信用卡定期定額參數規則）、2900（定期定額訂單作業ReAuth/Cancel）內容；`03-architecture/03-state-machines.md` §4 已有定期定額合約狀態機可參照，此檔應著重 Sequence Diagram 與建立/通知/補救時序，避免與 03-4 重複
- `docs/ecpay-blueprint/04-flows/07-invoice.md` — 電子發票（官方支援，獨立API家族）與金流的整合觸點
  - **尚未讀取**任何電子發票官方頁面內容；僅在 `00-scope-and-sources.md` §1.1 提及 einvoice 家族存在、`01-service-landscape.md` 全景圖有標示鄰接關係
  - 需要：B2C/B2B 開立、延遲開立、折讓、作廢的官方API端點（部分端點已在 `02-api-capability-matrix.md` 未涵蓋——**這是遺漏，需要**先讀取 `.claude/skills/ecpay/references/Invoice/` 三份索引檔＋web_fetch 對應官方頁面，才能撰寫）
- `docs/ecpay-blueprint/04-flows/08-error-handling.md` — 錯誤處理：錯誤分類、雙層檢查、限流403、降級策略
  - 素材已部分蒐集：guides/20（錯誤碼參考，**尚未讀取內容**）、guides/16（go-live-checklist，已讀取，含降級策略表可參照但不可直接複製，需改寫為架構層級的錯誤處理流程圖）
  - 官方「交易狀態代碼表」(5740)、「交易訊息代碼一覽表」等尚未 web_fetch
- `docs/ecpay-blueprint/05-testing/01-test-strategy.md` — 完全未開始
- `docs/ecpay-blueprint/05-testing/02-test-cases.md` — 完全未開始
- `docs/ecpay-blueprint/05-testing/03-sandbox-plan.md` — 完全未開始（素材：SKILL.md 已有完整測試帳號/測試卡號表，可直接引用官方公開資訊）
- `docs/ecpay-blueprint/05-testing/04-golive-and-regression.md` — 完全未開始（素材：guides/16-go-live-checklist.md 已完整讀取，可作為改寫依據，但需注意 guides/ 是 SNAPSHOT 非官方原文，撰寫時仍應以「架構藍圖」角度重整而非照抄）

### 尚未驗證項目

- 尚未檢查 `02-api-capability-matrix.md` 是否需要補充電子發票的 API 清單（目前該檔僅涵蓋金流四大服務，發票另立一節或併入需在完成 07-invoice.md 後回頭決定）
- 尚未做文件間交互連結檢查（各檔互相引用的相對路徑是否正確）
- 尚未讓使用者過目確認架構方向是否符合預期（本輪為自主執行，未經中途確認）

## 5. 重要上下文與決策紀錄

### 已確認的架構方向

- 協議層（CheckMacValue/AES）與業務層（訂單/退款決策）嚴格分離，是整份藍圖的核心設計原則，貫穿 03-architecture 全部四檔
- 三道對帳防線（回呼→主動查詢→每日對帳）是反覆出現的核心心智模型，`04-flows/02、03、04` 三檔都以此為骨架
- 冪等設計統一採「條件式 UPDATE」而非「先查後寫」，並強調 SET 必須改動 WHERE 引用欄位（呼應本專案 CLAUDE.md 的防禦性寫法通則）

### 設計原則（供後續文件延續一致性）

1. 每份文件開頭用一句話點出「本文件回答什麼問題」
2. 所有流程用 Mermaid（sequenceDiagram/stateDiagram-v2/flowchart/erDiagram）表達，文字僅補充圖無法承載的約束條件
3. 表格優先於長段落（API能力矩陣、決策表、對照表）
4. 每個「限制」都要標明來源是官方明文還是「社群觀察值」或「官方未說明」

### 已排除方案與原因

- **不依 10 個測試主題拆 10 個檔案**：任務要求的測試主題中有多組性質相近（策略+三層測試規劃可合併、四類案例可共用表格式），拆 4 檔而非 10 檔以避免過度碎片化，此決策已在 README.md §3 說明理由
- **不將 POS刷卡機/直播收款/Shopify/物流/ECTicket/電子收據 展開為獨立流程章節**：任務要求「金流相關」為主軸，這些屬於鄰接或線下服務，僅在 01-service-landscape.md 全景圖定位（唯一例外是電子發票，因任務明確列出且官方視為金流閉環一部分，仍需獨立成 07-invoice.md）

### 需要延續的注意事項

- **繼續使用 ecpay skill + WebFetch 即時查證官方頁面**，不可僅憑 guides/ SNAPSHOT 內容撰寫（本輪撰寫 01-05 flows 時，Subscription 部分內容參照 guides，但企業級規格應盡量以 web_fetch 官方頁面驗證後撰寫，尤其 Invoice 尚未讀取任何官方發票頁面，切勿憑訓練記憶杜撰 API 端點）
- 語言強制規則：全程繁體中文
- 絕對不得產生可執行程式碼（TypeScript/JavaScript/PHP/Java/C#等），僅允許 Mermaid、檔案結構、CheckMacValue偽代碼

## 6. 下一步執行計畫

### 建議執行順序

1. **`04-flows/06-subscription.md`**（素材已齊全，可直接撰寫，預估最快完成）
2. **`04-flows/08-error-handling.md`**（需先 web_fetch 官方「交易狀態代碼表」5740 頁及讀取 guides/20 內容，再撰寫錯誤分類與降級流程）
3. **`04-flows/07-invoice.md`**（需要最多新研究：讀取 `.claude/skills/ecpay/references/Invoice/` 三份索引檔 → web_fetch 對應官方 B2C/B2B 發票技術文件頁面 → 整理與金流的整合觸點）
4. **`05-testing/03-sandbox-plan.md`**（素材已齊全於 SKILL.md 測試帳號表，可較快完成）
5. **`05-testing/01-test-strategy.md`**
6. **`05-testing/02-test-cases.md`**
7. **`05-testing/04-golive-and-regression.md`**（可參照已讀取的 guides/16 內容改寫）
8. 最後：全文件交互連結檢查、README.md 文件樹核對是否與實際檔案一致

### 下一個 Session 應優先處理事項

從 `04-flows/06-subscription.md` 開始，因為素材已在本輪對話中蒐集完畢，可直接撰寫不需額外研究。

### 預估剩餘工作內容

8 份文件待撰寫（3 份 flows + 4 份 testing + 1 份最終檢查），其中 Invoice 需要額外的官方文件研究步驟。

## 7. Git 狀態

```
?? docs/ecpay-blueprint/
```

- **未追蹤檔案**：整個 `docs/ecpay-blueprint/` 目錄（13 個檔案）均為新增、尚未 git add
- **修改中的檔案**：無（皆為新建）
- **是否建議 commit**：**建議等全部文件樹完成後再一次性 commit**，避免中途 commit 造成「半成品」歷史記錄；若使用者希望保留中間進度，可先 commit 現有 13 份並於下輪繼續新增 commit（一份文件一支或一批次一支，依 CLAUDE.md 慣例由使用者決定）

## 8. 下一 Session 接續 Prompt

```
延續 ECPay Architecture Blueprint 任務（可重用金流架構藍圖，非本專案實作）。

背景：依據 ECPay Developers 官方技術文件（https://developers.ecpay.com.tw/2509/），
建立一份繁體中文、不含可執行程式碼（僅允許 Mermaid 圖與 CheckMacValue 演算法偽代碼）
的架構藍圖，供任何電商專案重複使用。所有文件唯一存放於 docs/ecpay-blueprint/。

已完成（13 份文件，請勿重複撰寫或重新研究）：
- README.md、00-scope-and-sources.md、01-service-landscape.md、02-api-capability-matrix.md
- 03-architecture/（01-module-design、02-data-model、03-state-machines、04-security）全部完成
- 04-flows/01-payment-flows.md、02-webhook.md、03-query.md、04-reconciliation.md、05-refund.md 已完成

尚未完成，請按此順序接續：
1. docs/ecpay-blueprint/04-flows/06-subscription.md
   （定期定額訂閱流程 Sequence Diagram：建立/通知/補授權/終止；
   素材可參照本次已完成的 03-architecture/03-state-machines.md §4 定期定額合約狀態機，
   但避免內容重複，本檔應著重時序流程而非狀態轉移）
2. docs/ecpay-blueprint/04-flows/08-error-handling.md
   （需先用 WebFetch 讀取官方「交易狀態代碼表」https://developers.ecpay.com.tw/5740.md，
   並讀取本機 .claude/skills/ecpay/guides/20-error-codes-reference.md 作為輔助，
   再撰寫錯誤分類、雙層檢查、限流403降級策略）
3. docs/ecpay-blueprint/04-flows/07-invoice.md
   （尚未做任何電子發票研究！需先讀取 .claude/skills/ecpay/references/Invoice/ 
   下三份索引檔，用 WebFetch 查證官方 B2C/B2B 電子發票技術文件頁面，
   整理發票與金流的整合觸點——不可憑記憶杜撰API端點）
4. docs/ecpay-blueprint/05-testing/01-test-strategy.md
5. docs/ecpay-blueprint/05-testing/02-test-cases.md
6. docs/ecpay-blueprint/05-testing/03-sandbox-plan.md
   （素材已齊全：.claude/skills/ecpay/SKILL.md 有完整測試帳號/測試卡號表可引用）
7. docs/ecpay-blueprint/05-testing/04-golive-and-regression.md
   （可參照已讀取的 guides/16-go-live-checklist.md 改寫，需重整為架構藍圖角度而非照抄）
8. 最後檢查 README.md 文件樹與實際檔案是否一致、各檔相對連結是否正確

規則提醒：全程繁體中文；官方文件未說明的資訊必須明確標示「官方未說明」；
禁止任何可執行程式碼；文件一律存放於 docs/ecpay-blueprint/，不得存放他處。
```
