# glossary.md — 專有名詞縮寫簡易對照

> 文件產出日期：2026-07-20
> 用途：本專案文件與程式碼裡常出現的縮寫／術語的白話對照，跨對話快速查閱。
> 排列：依領域分組，每條一行「縮寫 — 全稱 — 白話說明」。

---

## 1. 開發流程與工具

| 縮寫 | 全稱 | 白話說明 |
|------|------|----------|
| PR | Pull Request | 把 feature branch 的改動提出來請人審查、合併進主線的請求。 |
| CI | Continuous Integration | 持續整合。每次 push 自動跑 lint／型別／測試／build，把壞掉的改動擋在合併前。 |
| CD | Continuous Deployment/Delivery | 持續部署。通過 CI 後自動部署（本專案 Vercel preview＝staging、master＝production）。 |
| CI/CD | — | 上述兩者合稱，指「自動化的測試＋部署管線」。 |
| MVP | Minimum Viable Product | 最小可行產品。先做能跑通核心閉環的最小範圍，其餘留後續。 |
| E2E | End-to-End | 端到端測試。模擬真實使用者從頭到尾走完一條流程（如下單→付款）。 |
| RWD | Responsive Web Design | 響應式設計。同一頁面在手機／平板／桌機自動調整版面。 |
| SEO | Search Engine Optimization | 搜尋引擎最佳化，讓 Google 更容易收錄與排名。 |
| CRUD | Create/Read/Update/Delete | 資料的新增／讀取／更新／刪除，泛指後台管理功能。 |
| CSV | Comma-Separated Values | 逗號分隔的純文字表格（如 `tasks-todo.csv`）。 |
| MCP | Model Context Protocol | 讓 AI 代理連接外部工具／資料源的協定。 |
| SDK | Software Development Kit | 第三方提供的程式庫（如 Supabase SDK、Resend SDK）。 |
| TS | TypeScript | 本專案的程式語言（`.ts`／`.tsx`）；「TS 端」指應用程式碼，對照「DB 端」的 SQL 函式。 |

---

## 2. 資料庫與後端

| 縮寫 | 全稱 | 白話說明 |
|------|------|----------|
| RLS | Row Level Security | 資料列級權限。Postgres 依規則決定哪一列誰能讀寫；本專案 deny-by-default（預設全拒）。 |
| RPC | Remote Procedure Call | 呼叫資料庫端函式的**機制**（如 `transition_order_status`）。RPC 本身不等於原子交易——本專案把多段寫入包進同一個 DB function（＝同一交易單元），那次 RPC 才具備原子性（要嘛全成功、要嘛全 rollback）。 |
| FK | Foreign Key | 外鍵。一張表指向另一張表的關聯欄位（本專案帳務鏈用 RESTRICT、設定圖用 CASCADE）。 |
| enum | Enumerated type | 列舉型別。欄位只能取固定幾個值之一（如訂單 status）。 |
| CAS | Compare-And-Swap | 比較並交換。條件式更新：`UPDATE ... WHERE status='舊值'`，只有值仍相符才更新，用來防並發雙寫。 |
| TOCTOU | Time-Of-Check to Time-Of-Use | 檢查到使用之間的時間差。查完到寫入前狀態被別人改掉的競態窄窗。 |
| EvalPlanQual | — | Postgres 在 READ COMMITTED 下，更新撞到並發修改時「重新評估條件再試」的機制；本專案 `from=to` 守衛就是防它導致 CAS 失效。 |
| READ COMMITTED | — | Postgres 預設交易隔離級別；每個語句只看到已提交的資料（並發防護要據此設計）。 |
| PostgREST | — | Supabase 把資料表自動變成 REST API 的引擎；有些陷阱（numeric 回字串、`.or()` 需雙引號包 timestamp）源自它。 |
| PII | Personally Identifiable Information | 個人可識別資訊（姓名、電話、地址、email）；存取有稽核（`pii_access_log`）。 |
| Idempotent | 冪等 | 同一操作重複執行結果一致、不重複扣款/重複記帳（金流兜底的核心性質）。 |
| Service role | — | Supabase 的最高權限金鑰，繞過 RLS；只在伺服器端用（`import "server-only"` 防呆）。 |
| Cron | — | 排程任務（定時執行），如每日對帳、逾期取消、購物車清理。 |
| Serverless | — | 無伺服器函式；用完即凍結，故禁 fire-and-forget，一律 `await`。 |

---

## 3. 金流與 ECPay（綠界）

| 縮寫 | 全稱 | 白話說明 |
|------|------|----------|
| ECPay | 綠界科技 | 本專案的金流／電子發票／物流服務商。 |
| AIO | All In One | 綠界的整合式金流介面（目前信用卡走的導轉式收銀台）。 |
| ECPG | EC Payment Gateway | 綠界站內付 2.0；規劃取代 AIO 導轉式信用卡（T103，MVP 後才做）。 |
| Webhook | — | 綠界付款後主動 POST 到本站 `/api/ecpay/notify` 的背景通知，是付款判定的**權威來源**。 |
| CheckMacValue | — | 綠界回拋的驗章值，防竄改（金流用 SHA256、物流用 MD5，不可混用）。 |
| MerchantTradeNo | — | 送給綠界的交易編號（19 碼，由 order_no 重組，單一出處 `merchant-trade-no.ts`）。 |
| TradeNo / gateway_trade_no | — | 綠界端的交易號，退刷／對帳比對用。 |
| TradeStatus | — | 綠界回報的交易狀態碼（`1`＝已付款、`0`＝未付、`10200095`＝失敗）。 |
| 3DS | 3D Secure | 信用卡付款時的持卡人身份驗證機制。 |
| RMA | Return Merchandise Authorization | 退貨授權流程；本專案售後狀態設計參考此概念（尚未完整定案）。 |
| 對帳三臂 | — | 每日 reconcile cron 的三條救援：主臂（打綠界）/漂移臂（信任財務事實）/稽核臂（只偵測）。見 `system-flow-and-user-flow.md` 附錄 B。 |

---

## 4. 安全與身份

| 縮寫 | 全稱 | 白話說明 |
|------|------|----------|
| OTP | One-Time Password | 一次性驗證碼；本專案登入主推 email OTP（碼長不固定，4–10 位彈性）。 |
| Magic link | — | 免密碼登入連結（輔助方式）；落地頁需再按一次才消耗 token，防掃描器誤點。 |
| guest_token | — | 訪客身份 httpOnly cookie（30 天 rolling），關聯訪客購物車、驗擁有權。 |
| Session | — | 登入後的會話狀態（落在輸碼/點擊的當下裝置）。 |
| CSP | Content Security Policy | 內容安全政策，限制頁面能載入的資源；本專案由 `proxy.ts` 每請求動態產生（nonce＋strict-dynamic）。 |
| nonce | — | 一次性隨機字串；CSP 用它標記「這段 script 是我發的」，防 XSS 注入。 |
| HSTS | HTTP Strict Transport Security | 強制瀏覽器只用 HTTPS 連線的標頭。 |
| XFF | X-Forwarded-For | 代理層帶的來源 IP 標頭；取用有 fallback（`get-client-ip.ts`），非 Vercel 環境可偽造。 |
| SPF/DKIM/DMARC | — | 三種 email 寄件網域驗證機制，決定信會不會進垃圾桶（上線 T50 要設）。 |
| deny-by-default | — | 「預設全拒」：權限白名單制，沒明確允許就一律禁止。 |

---

## 5. 前端與 UX

| 縮寫 | 全稱 | 白話說明 |
|------|------|----------|
| PDP | Product Detail Page | 商品詳情頁（`/products/[slug]`），配置器內嵌於此。 |
| IA | Information Architecture | 資訊架構：網站地圖、導覽、URL 結構。 |
| OG | Open Graph | 社群分享時顯示的預覽圖／標題卡（OG image）。 |
| TSX | TypeScript + JSX | React 元件檔的副檔名（`.tsx`）。 |
| ISR | Incremental Static Regeneration | 靜態頁面增量再生（Next.js 快取策略之一）。 |
| PPR | Partial Prerendering | 局部預渲染（Next.js 16 Cache Components 的機制）。 |
| swatch | — | 色票；配置器裡選寶石色／金屬色的小色塊（T120）。 |
| stepper | — | 加減數量的「−/＋」控制元件。 |

---

## 6. 本專案自訂概念（非通用縮寫）

| 名詞 | 白話說明 |
|------|----------|
| 快照（snapshot） | 下單當下把價格／規格釘死存進 `unit_price_snapshot`／`config_snapshot`，日後調價不影響已成立訂單。 |
| 驗價（verify-prices） | 結帳時伺服器依 DB 白名單重算金額，絕不信任前端傳來的價格（紅線）。 |
| 白名單三層 | 配置器可選值的控制：類別 `applies_to`→款式 `ProductOption`→值 `ProductOptionValue`。 |
| PAID_LINEAGE | 付款成立契約集合＝`paid/in_production/shipped/completed`；決定哪些狀態該補寄確認信。 |
| 狀態機 | 訂單狀態的合法轉換規則（`VALID_TRANSITIONS`），見附錄 A。 |
| 主臂／漂移臂／稽核臂 | 對帳 cron 的三條救援臂，見附錄 B。 |
| webhook 側卡單 | payment 已 paid 但訂單卡 pending_payment 的漂移態（漂移臂負責救）。 |
| fail-visible | 子任務失敗時讓整支 cron 回 HTTP 500，讓監控看到紅燈，而非靜默當綠燈。 |
| sweep | 每日掃描補救（失敗通知補寄、未開票補開）的清掃動作。 |
| sendOnce | 關鍵信件去重寄送機制（`notification unique(order_id,type)`），防重複寄。 |
| Admin Override | 後台繞過狀態機把訂單改任意狀態的逃生口（必填理由、寫稽核 log、不翻 payment/不寄信）。 |
| service-role.ts | 走最高權限、繞過 RLS 的寫入路徑，僅伺服器端。 |
| ultra / ultrareview | 雲端多代理程式審查（`/code-review ultra`），計費、由使用者本人觸發。 |

---

## 常用第三方服務對照

| 服務 | 用途 |
|------|------|
| Supabase | Postgres 資料庫＋Auth＋Storage（雲端 production）。 |
| Vercel | 部署平台（含 CI、preview＝staging、Cron）。 |
| Resend | 交易信件寄送（訂單確認、通知）。 |
| Sentry | 錯誤／靜默失敗監控與告警。 |
| Upstash Redis | 速率限制（OTP 防濫發、對帳連續 403 計數）。 |
| ECPay 綠界 | 金流／電子發票／黑貓宅配物流。 |
