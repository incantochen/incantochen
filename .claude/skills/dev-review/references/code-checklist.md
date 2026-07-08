# Code 審查：閱讀地圖＋缺陷類別清單（第二遍用）

> 條目是**缺陷類別**；「校準範例」是本專案發生過的實例，用來讓你認得這類問題長什麼樣——**不是搜尋目標**。掃描時用類別描述找新位置，不是重新確認範例點位。

## 步驟 0：建立覆蓋母集（每次審查必做）

1. `git ls-files` 取得版控內全部檔案，排除純資產（`public/`、`*.svg`、`*.ico`、`docs/wireframe/`、`pnpm-lock.yaml`、`*.pdf`、`*.mermaid`）＝**應審母集**（未進版控的檔案如 `.env.local` 本來就不進審查範圍）
2. 母集與下方閱讀地圖 diff：**不在地圖上的新檔案自動列入本次審查範圍**；屬常設模組的，審後提議補進地圖
3. 對照 `docs/review-findings.md` 尾端的「檔案覆蓋表」：本次額外抽出**最久未審（或從未審過）的 5 個檔案**列入範圍——低風險檔案是低頻輪替，不是零覆蓋
4. 審查結束後更新覆蓋表（見 reporting.md）

## 閱讀地圖（第一遍走讀順序，風險由高至低）

1. **金流鏈**（整條走完）：
   - `src/lib/ecpay/check-mac-value.ts` — 簽章生成／驗證
   - `src/lib/ecpay/aio-payment.ts` — AIO 參數組裝
   - `src/lib/ecpay/merchant-trade-no.ts` — trade no 生成
   - `src/app/checkout/pay/page.tsx` — 付款頁（payment row 預建／復用）
   - `src/app/api/ecpay/notify/route.ts` — **webhook（全專案最關鍵檔案）**
   - `src/app/api/ecpay/order-result/route.ts` — 瀏覽器 redirect
   - `src/app/checkout/success/page.tsx`、`failed/page.tsx`
2. **結帳／建單**：`src/app/checkout/actions.ts`、`src/lib/quote/verify-prices.ts`
3. **購物車**：`src/app/products/[slug]/actions.ts`（addToCart）、`src/app/cart/actions.ts`、`src/lib/cart/*`
4. **Auth**：`src/app/login/actions.ts`、`src/lib/auth/*`、`src/proxy.ts`
5. **Email**：`src/lib/email/*`
6. **後台**：`src/app/admin/orders/**`、`src/lib/order/state-machine.ts`、`src/lib/pii/*`
7. **共用**：`src/lib/env.server.ts`／`env.ts`、`rate-limit.ts`

## 缺陷類別清單

### A. 金額與金流正確性

- [ ] **A1 前端金額信任**：任何寫入訂單／付款的金額，追溯其來源——必須是伺服器端依 DB 白名單重算，cart 快照與前端值都不可信
- [ ] **A2 回拋資料不完整核對**：外部系統回拋的每個關鍵欄位（金額、幣別、交易對象）都要與本地預期核對，不能只看成功旗標。校準範例：T68（只信 RtnCode、未核對 TradeAmt）
- [ ] **A3 回應語意錯置**：對外部系統的回應要準確反映處理結果——「吞掉錯誤回成功」會關掉對方的重試。校準範例：T68（catch → `1|OK`，付款通知永久遺失）
- [ ] **A4 簽章與加密**：驗證用 timing-safe 比對；不同用途的金鑰／演算法不可混用（金流 SHA256／物流 MD5）

### B. 冪等與競態

- [ ] **B1 check-then-insert 無約束兜底**：所有「查不到就建」的模式，DB 層必須有 unique 約束、程式容忍 `23505`。校準範例：T70（cart.guest_token 無 unique→併發重複購物車）
- [ ] **B2 狀態機守衛缺失**：狀態更新是否帶前置狀態條件（`.eq("status", ...)`)；多來源併發改同列的結果是否確定
- [ ] **B3 冪等下的副作用重複**：冪等重複路徑會不會重寄信、重扣款、重清購物車
- [ ] **B4 client 防護誤當伺服器冪等**：每個會產生錢／訂單／不可逆副作用的 server action，確認伺服器端自有冪等鎖——`disabled={isPending}` 只擋同一分頁，跨分頁／直接 curl 全繞過。校準範例：F-011／T98（createOrder 無伺服器冪等鎖→跨分頁併發建兩張訂單、可能重複扣款）

### C. 格式與生命週期

- [ ] **C1 格式互轉的邊界假設**：所有內外格式互轉的字串切割（slice／split／正則），核對兩端格式定義是否同步演進。校準範例：T67（trade no 加了 2 碼隨機後綴，`slice(11)` 的重組點沒跟上→付款客人被導回首頁）；同一格式的**每個**解析點都要查（notify 的 fallback 是另一個解析點）。**修復後追問「複本收斂了嗎」**：F-009／T96（T67 把兩處都改對，但沒抽成單一函式——根因〔複本失同步〕未除，下次格式演進即重演；修多點同 bug 時，驗收條件是收斂成單一出處＋round-trip 測試，不是「每處都改對」）
- [ ] **C2 暫時狀態無出口**：pending／cart／token 類狀態有沒有逾期機制；使用者中途放棄後回得來嗎。校準範例：T74（pending payment 復用 trade no，ECPay 端放棄後同號重送被拒）、T66（pending_payment 無時效）
- [ ] **C3 不可逆動作的時機**：清購物車、寄信、redirect 等不可逆動作是否在所有驗證與確認之後。校準範例：T75（建單即清車，付款失敗客人重配置）

### D. 信任邊界與存取控制

- [ ] **D1 識別碼即權限**：每條憑 id／order_no／token 操作資源的路徑，驗證資源歸屬（cookie／session／RLS）＋評估識別碼猜測成本（亂數強度用 crypto 級）。校準範例：T73（憑 order_no 看個資＋Math.random）
- [ ] **D2 未驗證身分綁定**：任何「用 email／手機找帳號」的邏輯，確認有所有權證明才綁定。校準範例：T71（訪客結帳 email 掛單他人帳號）
- [ ] **D3 權限檢查覆蓋率**：`/admin` 每個頁面與 server action 都有 `requireAdmin()`；受保護區域一個入口都不能漏
- [ ] **D4 PII 最小化**：每個對外輸出點（頁面、email、log）檢視揭露的個資是否必要；後台遮罩＋揭露稽核

### E. 輸入與輸出

- [ ] **E1 輸入無上限**：所有 Zod 字串欄位有 `max()`；數字有範圍
- [ ] **E2 sink 未跳脫**：使用者輸入流向 HTML（含 Email 模板）／shell／log 的每個點有對應跳脫。校準範例：T72（Email 模板 HTML 注入）
- [ ] **E3 錯誤訊息洩漏**：對外錯誤不含 DB error message／stack／內部路徑

### F. 錯誤處理

- [ ] **F1 靜默吞錯**：空 `catch {}`、忽略的 supabase `error`——每個都要有註記理由，否則是發現。校準範例：T79（findOrCreateMember）
- [ ] **F2 部分失敗殘留**：多步驟寫入無交易包裹時，中途失敗留下什麼、誰清理。校準範例：T76（孤兒訂單）、T77（tracking_no 先寫後驗）
- [ ] **F3 serverless 凍結**：HTTP 回應後的 `void promise` 不保證執行——副作用用 `waitUntil` 或 await。校準範例：T69

### G. 機制虛設

- [ ] **G1 設計了沒在用**：schema 的每個防護機制（unique 約束、去重表、稽核欄位）找到程式使用點，找不到＝防線不存在。校準範例：T69（notification 去重表零寫入）、T81（cart.member_id 全程未用）。變體「**部署了但防不到目標威脅**」：F-010／T97（CSP 已上線，但 production `script-src 'unsafe-inline'` 讓它對 XSS——CSP 存在的主要理由——攔截力為零；審安全機制不只問「有沒有」，要問「它宣稱防的那個威脅真的防得到嗎」）
- [ ] **G2 金鑰邊界**：server-only 模組有 `import "server-only"`；秘密只在 `env.server.ts`；service role 路徑（RLS 失效區）的輸入必經驗證
- [ ] **G3 濫用成本**：高成本／可灌爆的匿名寫入路徑有沒有限流與清理。校準範例：T78（addToCart 無限建 cart）
