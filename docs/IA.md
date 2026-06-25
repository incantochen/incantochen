# P04 IA — 資訊架構（Information Architecture）

> 文件更新日期：2026-06-24

> 任務：P04（M-1 規劃）。依賴 `docs/PRD.md`、`docs/user-flow.md`（v2）、`docs/brand-guide.md`（v2）。
> 範圍：MVP 全站**頁面清單／網站地圖／全域導覽／URL 與路由結構**，含全品類分類與全客製入口。
> 下游：`docs/wireframe/`（P05 各頁線框）。
> 狀態：v2（M-1 規劃全數完成、含 Wireframe）；M0 資料層 T03 建表＋T46 RLS 已套用至雲端 production（13 表＋11 policy）。
> 對齊基準：4 條動線（首購下單／回訪查單／售後申請／全客製預約）、13 張表資料模型、Next.js 16 App Router（`src/app`）。

---

## 0. IA 原則（呼應品牌與客群）

1. **自助、透明、低摩擦**：客群主導果斷、反感推銷——導覽淺、路徑短，價格與交期一路透明可見。
2. **配置器不獨立成頁**：半客製選配**於商品詳情頁內展開**（已定案），故**無 `/configure` 路由**；PDP 即是轉換主場。
3. **結帳即會員**：訪客可一路逛到結帳，於結帳以 Email 辨識／建立會員，不在前段設登入牆。
4. **公開唯讀 vs 受保護**：商品／目錄／說明頁全公開（利 SEO 與分享）；訂單／會員資料受 RLS 保護，僅本人可見。
5. **品類可擴充**：戒指起步，但 URL 與導覽結構需一次容納戒指／耳環／手鍊／項鍊，新增品類靠後台不動架構。
6. **chrome 克制**：導覽／頁尾只用品牌綠＋金＋中性，寶石色只出現在商品本身（依 brand-guide §4.3）。
---

## 1. 網站地圖（Sitemap）

```
incantochen
│
├─ 首頁  /                                   公開 · 品牌故事＋主打款 landing
│
├─ 商品  /collections                        公開 · 全品類目錄
│   ├─ /collections/rings                     戒指（MVP 起步品類）
│   ├─ /collections/earrings                  耳環
│   ├─ /collections/bracelets                 手鍊
│   ├─ /collections/necklaces                 項鍊
│   └─ /products/[slug]                        商品詳情頁（PDP）＝配置器內嵌
│
├─ 全客製  /custom                            公開 · 預約／詢問說明＋表單（Flow 4）
│
├─ 購物  （購物流程）
│   ├─ /cart                                   購物袋
│   ├─ /checkout                               結帳（Email＋收件＋配送＋同意條款＋驗價）
│   └─ /checkout/result                        付款結果頁（三態·主動對帳·輪詢）
│
├─ 會員  /account  （需登入·RLS）
│   ├─ /account                                會員中心首頁
│   ├─ /account/orders                         訂單列表
│   ├─ /account/orders/[id]                    訂單詳情（狀態時間軸·物流單號）
│   ├─ /account/orders/[id]/support            售後申請（僅從訂單發起·Flow 3）
│   └─ /account/profile                        個人資料（Email·姓名）
│
├─ 登入  /login                               Email → OTP 驗證碼（主）／magic link（輔）
│   └─ /auth/confirm                           magic link 落地頁（須再按一次「登入」）
│
├─ 說明／支援  （公開資訊頁）
│   ├─ /ring-size                              戒圍對照與量法（Flow 1 分支·T54）
│   ├─ /after-sales                            售後說明（七天／瑕疵／維修保養政策）
│   ├─ /faq                                    常見問題（可選·MVP 可後補）
│   └─ /contact                                聯絡資訊（可選）
│
├─ 法規  （上線必備）
│   ├─ /privacy                                隱私權政策（T36）
│   └─ /terms                                  服務條款（含七天例外·客製同意 wording·T36/T57）
│
└─ 後台  /admin  （需登入·角色控管·PII 遮罩）
    ├─ /admin/orders                           訂單管理（狀態·貼物流單號·退款）  ← M2
    ├─ /admin/orders/[id]                       訂單詳情處理
    ├─ /admin/support                           售後審核分流                      ← M2
    └─ /admin/products                          商品 CRUD（含選項白名單）          ← M3（回頭補）
```

> 後台（`/admin`）非 M-1/M1 主線，但 IA 一次納入避免日後改架構。M3 才實作商品 CRUD；訂單管理在 M2。

---

## 2. 全域導覽（Global Navigation）

### 2.1 頁首 Header（依 brand-guide §7.2 三欄式）

| 欄位 | 內容 | 行為 |
|---|---|---|
| 左 | 品牌字樣 `INCANTOCHEN`（大寫·寬字距） | → `/` |
| 中 | 主導覽連結（12px 大寫 `.22em`）：**COLLECTIONS · CUSTOM · ABOUT** | COLLECTIONS→`/collections`、CUSTOM→`/custom`、ABOUT→首頁品牌段或 `/about`（可選） |
| 右 | 線性 icon（stroke 1.4·18px）：**搜尋 · 會員 · 購物袋** | 搜尋→見下註、會員→`/account`（未登入導 `/login`）、購物袋→`/cart`（含件數徽章） |

- **COLLECTIONS 子導覽**：hover/點開展開品類（RINGS／EARRINGS／BRACELETS／NECKLACES）。MVP 僅戒指有商品，其餘品類顯示「即將推出」或暫隱（由後台上架自動點亮）。
- **透明浮層**：在深色 hero 上文字用 Paper、hover Gold；非 hero 頁切換為實底（Paper 底＋Ink 字）。
- **🔎 搜尋 icon**：MVP **不做全文搜尋**（無對應任務），建議 icon 先指向 `/collections`（或暫隱），**全站搜尋列 Phase 2**。← 待你確認是否暫隱。
### 2.2 頁尾 Footer

- **品類**：戒指／耳環／手鍊／項鍊（→各 `/collections/[category]`）
- **品牌**：關於 incantochen／預約訂製（`/custom`）
- **支援**：戒圍量法（`/ring-size`）／售後說明（`/after-sales`）／常見問題（`/faq`，可選）／聯絡（`/contact`，可選）
- **法規**：隱私權政策（`/privacy`）／服務條款（`/terms`）
- **品牌簽名**：wordmark＋一句 incanto 文案；社群 icon（若有）。
### 2.3 麵包屑（Breadcrumb）
- 商品線：`首頁 / 商品 / 戒指 / {品名}`。其餘公開資訊頁不強制。
---

## 3. URL 與路由結構（對應 `src/app`）

> 慣例：商品 PDP 用 `/products/[slug]`（與品類解耦，一個商品只有一個正規網址，利 SEO 與分享）；品類頁 `/collections/[category]` 作為列表入口。**配置器無獨立路由**（內嵌 PDP）。

| URL | `src/app` route | 動線 | Auth | 里程碑 | 對應任務 | 需 Wireframe |
|---|---|---|---|---|---|---|
| `/` | `app/page.tsx` | 入口 | 公開 | M1/M4 | — | ✅（已有 demo，微調） |
| `/collections` | `app/collections/page.tsx` | F1 | 公開 | M4（戒指目錄 M1） | T14、T15 | ✅ |
| `/collections/[category]` | `app/collections/[category]/page.tsx` | F1 | 公開 | M4 | T14、T15 | ✅（與目錄共版） |
| `/products/[slug]` | `app/products/[slug]/page.tsx` | F1 | 公開 | M1 | T14–T20、T55 | ✅✅（含配置器·核心） |
| `/custom` | `app/custom/page.tsx` | F4 | 公開 | M1 | （輕量表單·通知沿用 T49） | ✅ |
| `/cart` | `app/cart/page.tsx` | F1 | 公開 | M1 | T21 | ✅ |
| `/checkout` | `app/checkout/page.tsx` | F1 | 公開→建會員 | M1 | T22、T57、T41、T23 | ✅ |
| `/checkout/result` | `app/checkout/result/page.tsx` | F1 | 公開（憑訂單 token） | M1 | T26、T27、T53 | ✅ |
| `/account` | `app/account/page.tsx` | F2 | **需登入** | M1 | T08 | ✅ |
| `/account/orders` | `app/account/orders/page.tsx` | F2 | 需登入 | M1 | T28、T32 | ✅ |
| `/account/orders/[id]` | `app/account/orders/[id]/page.tsx` | F2/F3 | 需登入·RLS | M1/M2 | T29、T31、T32 | ✅ |
| `/account/orders/[id]/support` | `app/account/orders/[id]/support/page.tsx` | F3 | 需登入 | M2 | T33、T47 | ✅ |
| `/account/profile` | `app/account/profile/page.tsx` | F2 | 需登入 | M1 | T08 | ◻︎（簡單·可併） |
| `/login` | `app/login/page.tsx` | F2 | 公開 | M1 | T06、T58 | ✅ |
| `/auth/confirm` | `app/auth/confirm/page.tsx` | F2 | 公開（消耗 token） | M1 | T07 | ◻︎（極簡·一顆按鈕） |
| `/ring-size` | `app/ring-size/page.tsx` | F1 分支 | 公開 | M1 | T54 | ◻︎（內容頁） |
| `/after-sales` | `app/after-sales/page.tsx` | F3 | 公開 | M2/M5 | T36 | ◻︎（內容頁·律師審） |
| `/privacy` | `app/privacy/page.tsx` | — | 公開 | M5 | T36 | ◻︎（內容頁） |
| `/terms` | `app/terms/page.tsx` | — | 公開 | M5 | T36、T57 | ◻︎（內容頁） |
| `/admin/orders` | `app/admin/orders/page.tsx` | — | 需登入·角色 | M2 | T31、T47、T64 | ◻︎（P05 後補） |
| `/admin/orders/[id]` | `app/admin/orders/[id]/page.tsx` | — | 需登入·角色 | M2 | T31、T47 | ◻︎ |
| `/admin/products` | `app/admin/products/page.tsx` | — | 需登入·角色 | M3 | T... CRUD | ◻︎（M3 再做） |

**API route handlers（非頁面，列此供對照）**：
- `app/api/quote/route.ts` — 伺服器端驗價（T41，價格只信後端）
- `app/api/checkout/route.ts` — 建立訂單→導向綠界（T23、T24）
- `app/api/ecpay/webhook/route.ts` — 綠界背景通知（權威來源·驗 CheckMacValue·冪等·T26、T53）
- `app/api/ecpay/query/route.ts` — 主動對帳·訂單查詢 API（T27）
- `app/api/auth/otp/route.ts`、`app/api/auth/verify/route.ts` — OTP／magic link（T06、T07）
- 授權進入點：`src/proxy.ts`（Next.js 16，取代舊 middleware）；**授權不可只靠 proxy，後端 API 與 RLS 各自獨立驗證**。
> URL 安全：**勿在 query string 放個資或敏感值**；付款結果頁以不可猜測的訂單 token 辨識，不放 Email／訂單明細於網址。

---

## 4. 頁面清單與職責（Page Inventory）

> 每頁：目的｜關鍵內容區塊｜狀態／邊界｜對應動線。

**首頁 `/`** — 品牌故事＋主打款 landing（已採此角色，非直接導目錄）。
滿版深色 hero（eyebrow `incanto · 著迷`）→ 精選款（SELECTED PIECES）→ 品牌理念（QUIET LUXURY）→ 全客製區（CUSTOM·金 CTA「預約訂製」）→ 頁尾。已有 demo 驗證，P05 僅微調與接真資料。

**商品目錄 `/collections`／`/collections/[category]`** — 全品類列表。
品類切換（Tab/子導覽）→ 商品卡網格（brand-guide §7.4：寶石色點＋材質 meta＋serif 品名＋價格「起」）。MVP 僅戒指有貨，其餘品類「即將推出」。卡片圖優先含配戴／生活情境。**MVP 篩選／排序從簡**（品類即主篩）。

**商品詳情頁 PDP `/products/[slug]`** — ★轉換核心，配置器內嵌。
圖區（多角度＋配戴情境＋選配後靜態合成圖，依選項即時換圖）｜配置器（寶石→金屬色→規格→數量，依品類顯示可選值·白名單外灰階 disable）｜即時報價（底價＋Σ加價×數量·明細可展開）｜「下單後訂製·交期至少 XX 天」告知｜加入購物袋。戒指不確定戒圍 → 連 `/ring-size`。

**全客製預約 `/custom`** — 預約／詢問表單（MVP 只捕捉需求＋通知店家）。
說明文案（brand-guide §10.3 定案文案·語氣與半客製不混用）＋表單（欄位最小集見 §5 提案）→ 送出顯示「已收到，將盡快與妳聯繫」。不接金流、不建訂單。

**購物袋 `/cart`** — 檢視／調整。
品項列（縮圖＋選配摘要＋快照單價）｜改數量／刪除｜小計（仍以快照單價）｜前往結帳。空袋狀態導回目錄。

**結帳 `/checkout`** — Email＋收件＋配送＋同意＋驗價。
Email｜收件人／電話／地址｜配送（僅黑貓宅配·保價簽收）｜交期告知｜**勾選同意客製例外條款（未勾不可送·存同意＋時間戳·T57）**｜金額明細（含運費）｜送出前**伺服器端重算驗價**，前後端不一致以後端為準並提示「金額已更新」。送出→建訂單（待付款）→導向綠界。

**付款結果頁 `/checkout/result`** — 三態·主動對帳。
先顯示「確認付款中…」Loading→輪詢；**已付款**→解鎖查單／發票資訊；**已確認失敗／中斷**→訂單留待付款·可重試（新交易編號）；**尚未確認**→主動呼叫綠界訂單查詢 API；極少數逾時→「款項確認中，將以 email 通知你」。**逾時≠失敗，絕不顯示「失敗請重試」**（防雙重扣款）。

**登入 `/login`** — Email → OTP（主）／magic link（輔）。
輸 Email→寄信（含 6 碼＋連結·防濫發限流）｜輸 6 碼（落在當下裝置·不綁同裝置）｜錯誤友善＋一鍵重寄。

**magic link 落地 `/auth/confirm`** — 防掃描器誤觸。
極簡頁：一句說明＋一顆「登入」按鈕，**須再按一次才消耗 token**；失效→一鍵重寄。

**會員中心 `/account` 系列** — 訂單為主（範圍見 §5 提案）。
首頁（招呼＋近期訂單捷徑）｜訂單列表（狀態·日期·金額）｜訂單詳情（狀態時間軸 OrderStatusLog·已出貨顯示人工貼的 tracking_no·售後入口）｜個人資料（Email·姓名）。

**售後申請 `/account/orders/[id]/support`** — 僅從訂單發起（Flow 3）。
選類型（七天鑑賞退貨／瑕疵錯誤／維修保養）｜說明＋佐證｜送出建立售後紀錄＋通知店家。客製品主張七天例外 → 引導改走瑕疵申訴。**19 項待確認（user-flow §3.1）尤其 A、C 類須律師＋會計先收**——wireframe 先以「申請＋分類＋狀態顯示」骨架呈現，文字留待審。

**內容頁 `/ring-size`／`/after-sales`／`/privacy`／`/terms`** — 靜態說明。
單欄長文版型；`/terms`、`/after-sales`、`/privacy` 之**法律文字以律師審定版為準**，wireframe 只定版面與大綱。

**後台 `/admin/*`** — 營運用（M2 起）。
訂單管理（列表·篩選·改狀態·貼 tracking_no·退款·PII 遮罩＋存取稽核 T64）｜售後審核分流｜商品 CRUD（M3·含選項白名單管理）。P05 可後補，先聚焦前台 8 頁。

---

## 5. 待決項提案（§7 三項·請確認）

> 以下為我依現有決策與資料模型給的**具體提案**，確認後即併入 wireframe。

**① 會員中心範圍（影響 IA 結構）— 提案：訂單導向，最小可用。**
MVP `/account` = 訂單列表＋訂單詳情＋個人資料（Email／姓名）＋售後入口。
**不做收件人通訊錄／偏好管理**——理由：ER 採「Order 內嵌收件與物流」、**無獨立地址表**，每次結帳填收件即可；通訊錄需新表，與「不擴表」原則衝突。**收件人簿／偏好 → Phase 2**。

**② 預約訂製表單欄位（影響 `/custom` wireframe）— 提案：最小集。**
品項（戒指／耳環／手鍊／項鍊／不確定）｜預算帶（單選·對齊 2–5 萬區間＋其他）｜想法描述（多行）｜參考圖上傳（選填·Supabase Storage）｜聯絡方式（Email 必填＋電話選填）｜（選填）方便聯絡時段。送出＝建立詢問紀錄＋通知店家（沿用 T49 通知機制）。

**③ 情境圖位置與數量（影響 PDP wireframe）— 提案。**
PDP 圖區：**主圖（選配後合成圖·依選項即時換）＋ 2–3 張配戴／生活情境圖**穿插於圖庫；配置器選定後，主圖同步更新以強化「這就是我」。目錄卡片首圖**優先用配戴情境**而非純去背。數量上限以不拖慢載入為準。

---

## 6. 對齊檢查（IA × 動線 × 資料模型）

- **Flow 1 首購**：`/collections`→`/products/[slug]`（配置器內嵌·無獨立 config route ✓）→`/cart`→`/checkout`（驗價 T41·同意 T57）→綠界→`/checkout/result`（三態·主動對帳 ✓）。
- **Flow 2 查單**：`/login`（OTP 主·magic link 輔·`/auth/confirm` 再按一次 ✓）→`/account/orders`→`/account/orders/[id]`（狀態時間軸·tracking_no ✓）。
- **Flow 3 售後**：入口**僅** `/account/orders/[id]/support` ✓＋公開 `/after-sales` 說明頁 ✓。
- **Flow 4 預約**：`/custom` 表單·人工後續·不接金流 ✓。
- **資料模型**：PDP 配置器對應三層白名單（applies_to→ProductOption→ProductOptionValue）；cart/checkout 寫快照（unit_price_snapshot＋config_snapshot）；無地址表 → 會員中心不做通訊錄（§5①）✓。會員 `id ＝ auth.uid()`（共用 PK），`/account` 系列 RLS 以 `member_id = auth.uid()` 限本人 ✓（已落地 T46）。
- **品牌 chrome**：導覽／頁尾只綠＋金＋中性，寶石色限商品本身 ✓。
---

## 7. 下一步（P05 Wireframe 頁面清單）

依 §3「需 Wireframe」欄，P05 優先做**前台 8 頁**（✅✅／✅）：

1. 首頁（微調既有 demo）
2. 商品目錄／品類頁
3. **商品詳情頁＋配置器（核心·最可能回饋微調 T16 版面）**
4. 全客製預約表單
5. 購物袋
6. 結帳
7. 付款結果頁（三態）
8. 會員中心（含訂單列表／詳情／售後申請）
內容頁（`/ring-size`、`/after-sales`、`/privacy`、`/terms`）與 `/login`、`/auth/confirm` 為輕量版型，可隨後補；`/admin/*` 留至 M2/M3。

---

## 8. 待辦／提醒

- ⏳ 待你確認：§5 三項提案（會員中心範圍／預約欄位／情境圖）、§2.1 搜尋 icon 是否暫隱。
- ⚖️ `/terms`、`/after-sales`、`/privacy` 法律文字律師審；售後 19 項（user-flow §3.1）A、C 類先收。
- ✅ 已回填：「無 `/configure` 獨立路由·會員中心不做通訊錄·搜尋 Phase 2」已寫入 `memory.md` 與 repo `CLAUDE.md`，Claude Code 端已對齊。
- ⏭️ P05 Wireframe 已產出（前台 8 頁）；M0 資料層（T03/T46）已上雲，下一步 **dev seed（T43）→ M1**。
