# data-model — incantochen 13 張表 ER 定稿規格（v1）

> 文件更新日期：2026-06-24

> 任務：T03 前置（M1/M0 建表規格）。依賴 `jewelry_mvp_ER.mermaid`／`jewelry_mvp_ER.pdf`、`memory.md` §5、`CLAUDE.md` §5、`docs/migration-guide.md`。
> 範圍：13 張表的欄位級定稿規格、約束、索引、RLS 分類、快照 JSON 契約；含本次 review 發現的缺口與待決策。
> 下游：`T03` 建表 SQL、`T46` RLS、`T43` 種子、`T19` 快照結構、`T41` 伺服器端驗價、`T53` 冪等、`T42` 電子發票、`T47` 退款。
> 原則：**不增刪表（維持 13 張）**；只補欄位／約束／索引；任何牴觸鎖定決策的改動先停下提醒。
> 狀態：✅ 本規格已落地——`0001`／`0002` 已套用至雲端 production（T03/T46 完成、型別已生、commit `c124482`）。

---

## 0. 圖例與約定

- 狀態標記：✅ 已定 · 🆕 待決策（建議已附）· ⚖️ 須律師／會計審 · ⚠️ 高風險 · 🔁 須回填 memory.md/CLAUDE.md · 🚫 不做。
- **主鍵**：一律 `uuid`（`gen_random_uuid()`）。**時間**：`timestamptz`，預設 `now()`。
- **金額**：`numeric(12,0)`，**新台幣整數元（無小數）**，與綠界 ECPay 一致；加價值 `price_delta` MVP 設 `CHECK (>= 0)`。
- **不增表**：本次所有缺口都用「在既有表補欄位／約束」收斂，13 張表數量不變。

---

## 1. 本次 review 結論（對齊最新終端機狀態）

| 項目 | 現況 |
|---|---|
| repo 階段 | M0 骨架完成；Supabase／Zod／ECPay／測試框架**尚未安裝**；**13 張表尚未建立**（T03 未開始） |
| migration 工具 | ✅ **Supabase CLI**（`docs/migration-guide.md` v1 已定）— 手寫 SQL 於 `supabase/migrations/` |
| ER 結構（13 張表＋關聯） | 大方向正確、可進 T03；本次補 **7 項欄位級缺口**（見 §3），不動表數 |
| 三個核心設計 | 白名單三層、快照欄位、Order 內嵌收件 —— 結構皆在，本次把「契約」釘死（見 §5） |

> ⚠️ 同步落差：`memory.md` §6 第 12 項與 §10 仍把 migration 工具列為「待決策」，但 `CLAUDE.md` §2 與 `docs/migration-guide.md` 已定案 Supabase CLI。**請回填 memory.md**（見 §8 🔁）。

---

## 2. 13 張表總覽（4 組 ＋ RLS 分類）

| 組 | 表 | 用途 | RLS 類別 |
|---|---|---|---|
| 商品與選項 | `Product` | 款式（含 `category`、`base_price`、上下架 `status`） | 公開唯讀 |
| | `OptionType` | 選項類別（層1 `applies_to`） | 公開唯讀 |
| | `OptionValue` | 選項值（祖母綠／18K黃金／#11） | 公開唯讀 |
| | `ProductOption` | 此款套用哪些選項（層2） | 公開唯讀 |
| | `ProductOptionValue` | 此款此值的白名單＋加價（層3） | 公開唯讀 |
| 會員與購物車 | `Member` | 會員資料（綁 Supabase Auth uid） | 本人 |
| | `Cart` | 購物車（會員或訪客） | 本人／訪客（後端） |
| | `CartItem` | 車內項目＋**快照** | 本人／訪客（後端） |
| 訂單與金流 | `Order` | 訂單（內嵌收件、`custom_consent`、金額） | 本人讀／後端寫 |
| | `OrderItem` | 訂單項目＋**快照** | 本人讀／後端寫 |
| | `Payment` | 付款（綠界，多次重試掛同一訂單） | 後端寫；本人讀 |
| 通知與狀態 | `OrderStatusLog` | 狀態轉換稽核 | 後端寫；本人讀 |
| | `Notification` | 寄信紀錄 | 後端 |

---

## 3. Review 發現：7 項欄位級缺口與修正

> 全部用「補欄位／約束」處理，**不新增表**。標 🆕 者建議已附、需你拍板。

### 3.1 🆕 `Member` 與 Supabase Auth 的綁定方式（**T46 RLS 的前提，最關鍵**）

登入走 Supabase Auth（OTP 主／magic link 輔），會產生 `auth.users.id`。目前 `Member` 與它沒有對應欄位，RLS「會員只讀自己訂單」無從寫起。

| 方案 | 做法 | RLS 寫法 |
|---|---|---|
| **(建議) 共用 PK** | `Member.id` ＝ `auth.users.id`（1:1 profile 延伸） | `member_id = auth.uid()`，最乾淨 |
| 另立 FK | 另開 `Member.auth_user_id uuid UK → auth.users.id` | 需多一層 join，RLS 較囉嗦 |

**建議採共用 PK**：OTP 驗證成功後，以 `auth.uid()` 建立／辨識 `Member`（對齊 T23「用 email 建會員或辨識既有會員」）。→ 寫 T05/T46/T23 前定案。

### 3.2 🆕 訪客購物車的可定址識別（**結帳即會員的合併前提**）

`Cart.member_id` 可空（訪客），但訪客 cart **沒有跨請求識別子**，無法在「結帳即會員」當下把訪客車併進新會員。

- **建議**：`Cart` 補 `guest_token uuid`（隨機、放 httpOnly cookie）；OTP 成會員時把該訪客車 `member_id` 補上或併入既有車。
- 約束：`member_id` 與 `guest_token` **至少一個非空**（`CHECK`）。
- 兼容方案：改用 Supabase anonymous sign-in 取得 anon uid 當識別子（但仍建議顯式 `guest_token`，少依賴）。→ 寫 T20/T22 前定案。

### 3.3 ✅ `Payment` 補退款狀態＋綠界 gateway 欄位（**T26/T27/T53/T47 必需**）

`Payment.status` 目前 `pending/paid/failed`，但 `Order.status` 有「已退款」而 `Payment` 無對應；對帳（T27）與冪等（T53）也需要綠界端的交易識別。

- `status` enum 補 **`refunded`**（→ `pending/paid/failed/refunded`）。
- 補 `gateway_trade_no text`（綠界 `TradeNo`，與我方 `merchant_trade_no` 不同；對帳／退刷用）。
- 補 `raw_callback jsonb`（回拋／查詢原始內容，稽核與重放）。
- **冪等鎖**：每張 `Order` 最多一筆 `paid`（部分唯一索引 `unique (order_id) where status='paid'`），落實「狀態只前進一次」。

### 3.4 🆕 電子發票欄位落點（**T42 / 退款折讓**）⚖️

`Order` 無發票欄位；發票由綠界開立（T42），且已開發票退款須開折讓單／作廢（財政部規定）。維持「不增表」原則下：

- **建議**：`Order` 補 `invoice_no text`、`invoice_status text`（none/issued/allowance/voided）。統編／載具屬選填，MVP 可暫存於 `config_snapshot` 同層的 `invoice_meta jsonb`（或先不收）。
- ⚖️ 折讓／作廢的**會計流程**屬 Flow 3 售後 C 類待確認，**須會計確認**後再定欄位細節。T42 為 M5，可延後拍板但**先佔欄位**避免日後改 schema。

### 3.5 ⚠️ `quantity` 同時被建模兩次 —— 須擇一

`OptionType.code` 範例含 `quantity`（stepper），但 `CartItem`／`OrderItem` 已有 `quantity int`，且報價為「底價＋Σ加價×**數量**」（T18）。數量是**行數量乘數**，不是有 `price_delta` 的白名單選項。

- **建議**：**從 `OptionType` 拿掉 `quantity`**；數量一律走 `CartItem.quantity`／`OrderItem.quantity`。配置器的數量 stepper 寫入行數量，不產生 `ProductOptionValue`。
- 影響：`OptionType.code` 範例改為 `gem_color/metal_color/ring_size/length/earring_back`；`input_type` 的 `stepper` MVP 可暫無對應選項（保留 enum 無害）。→ 寫 T43 種子／T16 配置器前確認。

### 3.6 ✅ 補 `updated_at` 與必要 `NOT NULL`／enum

- 會變動的表補 `updated_at timestamptz`（trigger 自動更新）：`Product`、`Cart`、`CartItem`、`Order`、`Payment`。
- `Product.status`、`Order.status`、`Payment.status` 一律 **Postgres enum 型別**（非自由 text），杜絕非法狀態。
- 金額欄全部 `NOT NULL`；`unit_price_snapshot`／`config_snapshot` 在 `CartItem`/`OrderItem` 皆 `NOT NULL`。

### 3.7 ✅ `Notification` 去重、`OrderStatusLog` 不可變

- `Notification` 補 `status text`（sent/failed）；對「下單確認」等關鍵信加 `unique (order_id, type)` 防重寄（對齊 T53 冪等精神）。
- `OrderStatusLog` 為稽核：只 insert、不 update／delete（RLS／權限層面禁改）。

> 📌 不另開稽核表：T64「後台 PII 存取稽核」維持**應用層 log**（Supabase log／app log），**不新增 DB 表**，符合「勿增表」。

---

## 4. 三個核心設計的落實契約

### 4.1 白名單三層（資料驅動配置器）
`OptionType.applies_to`（層1 品類過濾）→ `ProductOption`（層2 此款套用）→ `ProductOptionValue`（層3 此款此值＋`price_delta`＋`is_default`）。**前端只能顯示層3 白名單內的值；驗價以伺服器端白名單為準（T41 紅線），絕不信任前端價格。** 配置器**於 PDP 內展開、無 `/configure` 路由**。

### 4.2 快照契約（`config_snapshot` jsonb 標準形狀）
下單／加車當下釘住，後台日後調價不影響已成立項目。建議標準形狀（T19 定、T41 重算對照）：

```json
{
  "product_id": "uuid",
  "base_price": 32000,
  "selections": [
    { "option_type_code": "gem_color",  "option_value_code": "emerald", "label": "祖母綠",  "price_delta": 0 },
    { "option_type_code": "metal_color", "option_value_code": "gold18k", "label": "18K黃金", "price_delta": 3000 },
    { "option_type_code": "ring_size",  "option_value_code": "us6",     "label": "#11",     "price_delta": 0 }
  ],
  "line_unit_price": 35000
}
```
`unit_price_snapshot` ＝ `base_price ＋ Σ price_delta`（＝ `line_unit_price`）；行小計 ＝ `unit_price_snapshot × quantity`。

**商品名稱快照（T65，migration 0005）**：`OrderItem` 另有 `product_name_snapshot text` 欄位，`createOrder` 寫入時與價格同一次伺服器驗證取得、一併釘住；顯示端（會員／後台／Email／ECPay ItemName）一律快照優先，join `product.name` 現值僅作 null 窗口 fallback。刻意 nullable（避免部署窗口期 NOT NULL violation 中斷結帳），既有資料由 migration 回填。`CartItem` 不加名稱快照——購物車為暫態，顯示現值是正確行為。

### 4.3 Order 內嵌收件與物流
不另開地址表／工單表；`recipient_*`、`shipping_address`、`tracking_no`（人工填）內嵌於 `Order`。→ 故會員中心**不做通訊錄**。

---

## 5. 約束與索引清單（T03 直接照建）

| 表 | 唯一鍵／約束 | 索引 |
|---|---|---|
| `Product` | `slug` UK；`status` enum | `(category, status)`（目錄 T14） |
| `OptionType` | `code` UK | — |
| `OptionValue` | `(option_type_id, code)` UK | `option_type_id` |
| `ProductOption` | `(product_id, option_type_id)` UK | `product_id` |
| `ProductOptionValue` | `(product_option_id, option_value_id)` UK | `product_option_id` |
| `Member` | `id` ＝ auth.uid()（§3.1）；`email` UK | — |
| `Cart` | `member_id` 與 `guest_token` 至少一非空（§3.2 CHECK） | `member_id`、`guest_token` |
| `CartItem` | — | `cart_id`、`product_id` |
| `Order` | `order_no` UK；`status` enum | `member_id`、`status` |
| `OrderItem` | — | `order_id`、`product_id` |
| `Payment` | `merchant_trade_no` UK；每單最多一筆 paid（§3.3 部分唯一索引） | `order_id` |
| `OrderStatusLog` | 只可 insert | `order_id` |
| `Notification` | `(order_id, type)` UK（關鍵信，§3.7） | `order_id` |

外鍵刪除策略：商品被引用時不得硬刪（用 `status` 下架）；`CartItem`→`Cart` 可 `ON DELETE CASCADE`；`OrderItem`/`Payment`/`Log`/`Notification`→`Order` **不 cascade**（訂單為帳務，保留）。

---

## 6. RLS 分類（T46 照表寫 policy）

| 類別 | 表 | policy 要點 |
|---|---|---|
| 公開唯讀 | `Product`、`OptionType`、`OptionValue`、`ProductOption`、`ProductOptionValue` | `select` 全開；寫入僅後端（service role） |
| 本人 | `Member`、`Order`、`OrderItem`、`Payment`、`OrderStatusLog`、`Notification` | `select` 限 `member_id = auth.uid()`（Order 子表用 join Order）；寫入走後端 |
| 訪客／本人 | `Cart`、`CartItem` | 會員 `auth.uid()`；訪客以 `guest_token` 走後端驗證寫入，不開前端直寫 |

> 紅線提醒：所有敏感寫入走後端、白名單驗價在伺服器端（T41）；授權不可只靠 `proxy.ts`，後端 API 與 RLS 各自獨立驗證。

---

## 7. 待辦／提醒

- 🆕 **待決策（寫 T03 前必拍板）**：
  1. `Member` 綁 auth 的方式 —— 建議**共用 PK**（§3.1）。
  2. 訪客車識別子 —— 建議 `Cart.guest_token`（§3.2）。
  3. `quantity` 擇一 —— 建議**從 `OptionType` 移除**，走行數量（§3.5）。
- 🆕／⚖️ **發票欄位（§3.4）**：T42（M5）可延後，但**先佔欄位**避免改 schema；折讓／作廢流程**須會計確認**（Flow 3 售後 C 類）。
- ✅ 可直接納入 T03：`Payment` 補 `refunded`／`gateway_trade_no`／`raw_callback`＋每單一筆 paid（§3.3）、`updated_at`／enum 化（§3.6）、`Notification` 去重（§3.7）、索引與約束（§5）、RLS 分類（§6）。
- 🔁 **同步**：本檔定案後回填
  - `memory.md`：§6/§10 把「migration 工具」由待決策改為**已定（Supabase CLI）**；§5 補本檔三個契約與 7 項修正摘要；§產出清單加 `docs/data-model.md`；§待辦更新。
  - `CLAUDE.md`：§5 資料模型補「`Member` 綁 auth.uid()／訪客 `guest_token`／`Payment` 退款＋gateway 欄位＋每單一筆 paid／`quantity` 走行數量」幾條具體規則。
- ⏭️ **下一步**：你拍板 §7 三項待決策 → 我把確認後的決策**回寫 `jewelry_mvp_ER.mermaid`（並可重出 PDF）**，同步回填 memory.md／CLAUDE.md → 即可進 **T03 建表 SQL（Supabase CLI）→ T46 RLS → T43 種子**。
