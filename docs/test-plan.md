# test-plan.md — E2E 測試計畫與測試紀錄規範（v1）

> 文件更新日期：2026-07-08
> 用途：定義「code review 完成後」的自動化測試階段——測什麼（測試案例矩陣）、怎麼全自動跑、紀錄長什麼樣。實作＝T106。
> 定位分工：本檔管「測什麼＋紀錄規範」（規劃層）；`tests/e2e/README.md`（隨 T106 建立）管「怎麼跑＋踩坑」（操作層）；測試原則見 `coding-system.md` §5.4；金流測試設計參考 `ecpay-blueprint/05-testing/`。
> 維護原則：新任務落地時把驗收案例補進對應 Suite（TC 編號遞增不重用）；每次跑完自動產出紀錄（§4），不手寫。

---

## 1. 在開發流程中的位置

```
實作完成 → /code-review high 修完 findings → pnpm verify:all（本檔定義的自動測試階段）→ 全綠才開 PR
```

`pnpm verify:all` ＝ `lint → tsc --noEmit → vitest → build → E2E（Playwright）→ 產出測試紀錄`，一個指令全自動，中途任一步失敗即停。

- **E2E 不進 CI、不進 completion-check hook**（打真網路＋真 DB，非確定性）；CI（T101）只跑 lint＋vitest。
- `@sandbox` 標籤的案例（ECPay 真實付款）預設跳過，金流改動時以 `pnpm test:e2e --grep @sandbox` 手動開啟。
- **依 diff 選跑**：日常任務可只跑受影響 Suite（如 `pnpm test:e2e flows/account`）；碰金流／結帳／auth 的任務跑全套。

## 2. 環境與資料安全（紅線）

- ⚠️ 目前 E2E 指向 **production DB**（`.env.local`）。每次執行產生唯一 `runId`，所有測試資料（member email＝`e2e-<runId>-*@example.com`、訂單、購物車）都掛 runId；global teardown **無論成敗**以 runId 全面清除；另備 `pnpm e2e:cleanup` 掃歷史殘留。
- T82 環境分離完成後改指向 staging／獨立 DB，本節紅線降級為慣例。
- 登入一律 `admin.generateLink()`（不寄真信，避開 Supabase 寄信限流）；寄信類案例驗 `notification` 表與 Resend API 回應，不驗收件匣。

## 3. 測試案例矩陣（Suite × TC）

> 「驗證的 Invariant」欄對齊 coding-system.md §1.5——每條不變量都要有案例覆蓋。自動化欄：✅ Phase 1 實作／🅂 @sandbox 手動開啟／🖐 維持人工。

### S1 商品與配置器

| TC    | 案例                  | 預期                                                            | 自動化 |
| ----- | --------------------- | --------------------------------------------------------------- | ------ |
| S1-01 | 開啟 PDP（有效 slug） | 商品名／底價／三組白名單選項／預設值標記正確                    | ✅     |
| S1-02 | 無效 slug             | 404                                                             | ✅     |
| S1-03 | 切換選項＋改數量      | 單價＝底價＋Σprice_delta、小計＝單價×數量即時更新；加價明細正確 | ✅     |

### S2 購物車

| TC    | 案例                         | 預期                                                                                                         | 自動化 |
| ----- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| S2-01 | 加入購物車                   | DB `cart_item.unit_price_snapshot`＝伺服器重算值（非前端值）；`config_snapshot` 符合 §4.2 契約；徽章數字更新 | ✅     |
| S2-02 | 改數量／刪除                 | 畫面與 DB 同步；小計正確                                                                                     | ✅     |
| S2-03 | 竄改他人 cart_item id 改數量 | 拒絕（擁有權檢查），DB 無變動                                                                                | ✅     |
| S2-04 | 空車訪問 /checkout           | 導回 /cart                                                                                                   | ✅     |

### S3 結帳與建單

| TC    | 案例                 | 預期                                                                      | 自動化 |
| ----- | -------------------- | ------------------------------------------------------------------------- | ------ |
| S3-01 | 完整結帳（新 email） | 建 orders＋order_item（三快照齊全）＋背景建會員＋清車＋導向 /checkout/pay | ✅     |
| S3-02 | 未勾客製同意         | 擋下不可送出                                                              | ✅     |
| S3-03 | 結帳期間後台改價     | 不建單、回 priceUpdated、cart 快照更新、畫面 amber 警示（R/S/Q loop）     | ✅     |
| S3-04 | 既有會員 email 結帳  | T71 修復：回 requiresLogin、不建單、不洩漏帳號存在與否的可辨識文字        | ✅     |

### S4 金流（webhook 以 simulateWebhook() 自組合法 CheckMacValue 直打 notify）

| TC    | 案例                                                         | 預期                                                                                       | 自動化 |
| ----- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------ |
| S4-01 | webhook 成功回拋                                             | payment→paid、orders→paid、order_status_log 一筆、確認信＋店家通知（notification 表 sent） | ✅     |
| S4-02 | 同一回拋重送（連打兩次）                                     | 第二次回 1\|OK 且零重複副作用（log 不重複、信不重寄）                                      | ✅     |
| S4-03 | 驗章失敗（竄改 CheckMacValue）                               | 拒絕、回 0\|Error、DB 無變動                                                               | ✅     |
| S4-04 | 金額不符（竄改 TradeAmt）                                    | 拒絕處理、訂單維持 pending_payment                                                         | ✅     |
| S4-05 | 失敗回拋（RtnCode≠1）                                        | payment→failed、訂單維持 pending_payment、/checkout/failed 可重試                          | ✅     |
| S4-06 | ECPay sandbox 實付全流程（下單→收銀台→付款→webhook→success） | 端到端成功；金流改動任務的 DoD                                                             | 🅂      |
| S4-07 | 對帳 cron（pending payment＋綠界已付）                       | 手動觸發 reconcile 後狀態修正（T89）                                                       | 🅂      |

### S5 會員與 Auth

| TC    | 案例                                                   | 預期                               | 自動化 |
| ----- | ------------------------------------------------------ | ---------------------------------- | ------ |
| S5-01 | OTP 登入→/account→登出→重訪被導回 /login               | 全程正確；member row 建立          | ✅     |
| S5-02 | magic link 落地頁                                      | 不自動消耗 token，按鈕後才登入     | ✅     |
| S5-03 | ?redirect= 外站 URL                                    | 退回站內（T86 修復後轉為回歸案例） | ✅     |
| S5-04 | 訂單列表／詳情（時間軸、快照名稱、下架商品仍正確顯示） | 正確                               | ✅     |
| S5-05 | 直接訪問他人訂單／他人 support URL                     | 404（RLS＋顯式歸屬雙層）           | ✅     |

### S6 售後

| TC    | 案例                                              | 預期                                                                    | 自動化 |
| ----- | ------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| S6-01 | 可申請狀態訂單送出商品問題回報                    | support_request 建立（return_defect/pending）、店家通知信、詳情頁摘要卡 | ✅     |
| S6-02 | 不可申請狀態（pending_payment 等）直訪 support 頁 | 擋下無表單                                                              | ✅     |
| S6-03 | 說明欄 <10 字                                     | onBlur 擋下                                                             | ✅     |

### S7 後台

| TC    | 案例                               | 預期                                  | 自動化 |
| ----- | ---------------------------------- | ------------------------------------- | ------ |
| S7-01 | 非 admin 訪問 /admin/orders        | 拒絕                                  | ✅     |
| S7-02 | 列表篩選／搜尋／分頁；PII 預設遮罩 | 正確                                  | ✅     |
| S7-03 | 合法狀態轉換＋出貨（單號）         | 狀態更新、log 寫入、出貨通知信 sent   | ✅     |
| S7-04 | 「顯示完整個資」                   | 揭示成功＋pii_access 稽核紀錄產生     | ✅     |
| S7-05 | Admin Override                     | 任意轉換成功、is_override=true 入 log | ✅     |
| S7-06 | 售後案件狀態更新／手動建案         | DB 正確                               | ✅     |

**人工保留項（🖐，不自動化）**：視覺／RWD 走查（T40）、Email 版面實際渲染（各家信箱）、securityheaders.com 掃描（T38）、production cron 首次執行確認。

## 4. 測試紀錄規範（全自動產出，不手寫）

- 每次 `verify:all`／`test:e2e` 結束自動產出：
  - **`tests/e2e/records/<YYYY-MM-DD>-<branch>-<shortsha>.md`**（進 git，隨 PR 提交）：執行環境（commit、branch、DB 目標、runId）、各 Suite/TC pass·fail·skip 一覽表、失敗案例的錯誤摘要、耗時、清理結果（殘留=0 確認）。由自訂 Playwright reporter 生成。
  - Playwright HTML report＋trace（`tests/e2e/report/`，**git-ignored**）：除錯用，失敗時看這裡。
- PR 描述引用該筆紀錄檔＝「測試已跑」的證據；review 時可直接查對應 TC 結果。
- 紀錄只增不改；`records/` 累積過大時按季歸檔。

## 5. 分期與依賴

| 期              | 內容                                                                    | 條件                          |
| --------------- | ----------------------------------------------------------------------- | ----------------------------- |
| Phase 1（T106） | helpers＋S1–S7 ✅ 級案例＋`verify:all`＋自動紀錄＋`tests/e2e/README.md` | 依賴 T51 ✅、T85 ✅；即可動工 |
| Phase 2         | E2E 改打 staging／獨立 DB；@sandbox 案例納入例行                        | T82 完成後                    |
| Phase 3（可選） | nightly E2E（GitHub Actions 排程＋secrets）                             | T101 CI 落地後評估            |
