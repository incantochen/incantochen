# security-account-key-ops.md — T91 帳號與金鑰營運安全執行清單

> 文件產出日期：2026-07-20
> 用途：T91 的可執行 checklist。程式面防線紮實，實際曝險面在**營運層**——金鑰保管、第三方帳號、平台級防護。本檔逐項可打勾。
> 定位：上線必要子集（🚀，見 `launch-scope.md`）；與 `security-foundation.md`（程式地基漂移檢核）互補——那份驗程式防線沒被繞過，本份管帳號/金鑰/平台。
> 分工：**Dashboard 操作一律使用者本人執行（Claude 不經手金鑰）**；Claude 負責設定檔（Dependabot、Vercel firewall config、BotID 程式整合）與程序文件。
> ⚠️ 碰 auth/session/金流設定的程式改動（如 BotID 保護結帳/登入）依 CLAUDE.md §7 實作前先進 plan mode。

---

## 0. 威脅模型速記（為什麼做這些）

攻擊者理性上會放棄硬打 app（驗價、金流冪等、RLS、CSP、限流都有守衛），轉攻**營運層**：
- **金鑰外洩** → service role key 外洩＝全 DB 門戶大開；ECPay HashKey/IV 外洩＝可偽造付款。
- **第三方帳號被盜** → 攻破 Supabase/Vercel/綠界/GitHub/`ADMIN_EMAIL` 信箱，程式防線瞬間歸零。
- **設定錯誤** → 環境未分離（T82）、備份未設（T34）放大傷害。
- **平台級濫用** → 無 WAF/BotID 時，bot/DDoS/刷卡測試門檻低。

---

## 1. 帳號安全（全 Dashboard）

- [ ] **Supabase** 帳號開 2FA（TOTP）
- [ ] **Vercel** 帳號開 2FA
- [ ] **GitHub**（incantochen）帳號開 2FA＋passkey
- [ ] **Resend** 帳號開 2FA
- [ ] **綠界 ECPay 特店後台** 開 2FA / 綁定裝置（依綠界支援）
- [ ] **Google Cloud**（若做 T139 OAuth）帳號開 2FA
- [ ] **`ADMIN_EMAIL` 那個信箱本身**開 2FA＋強密碼——⚠️ `requireAdmin` 靠這個信箱收 OTP，**誰能收信誰就是後台管理員**，這個信箱＝後台的真正鑰匙
- [ ] 各平台檢查**最小權限**：無用不到的協作者/成員；離職/測試帳號移除
- [ ] 各平台的 **API token / personal access token** 盤點：無過期未撤銷的、無權限過大的
- [ ] 密碼管理器保管所有 Dashboard 登入，**不重複用密碼**（防撞庫）

---

## 2. 金鑰清冊與保管

盤點所有 secret，依「洩漏爆炸半徑」分級。**分級決定輪替優先序與監控強度。**

| Secret | 位置 | 爆炸半徑 | 分級 |
| ------ | ---- | -------- | ---- |
| Supabase **service role key** | `SUPABASE_SERVICE_ROLE_KEY` | 繞過 RLS、全 DB 讀寫 | 🔴 最高 |
| ECPay **HASH_KEY / HASH_IV** | `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` | 可偽造 webhook 假造付款 | 🔴 最高 |
| **CRON_SECRET** | `CRON_SECRET` | 濫觸 cron（危害有限，cron 冪等） | 🟠 中 |
| **RESEND_API_KEY** | `RESEND_API_KEY` | 冒名寄信、耗額度 | 🟠 中 |
| **Upstash** URL/TOKEN | `UPSTASH_REDIS_*` | 讀寫限流資料、破限流 | 🟠 中 |
| Supabase **anon key** | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 前端本就公開，受 RLS 約束 | 🟢 低（設計上公開） |
| Sentry DSN | `SENTRY_*` | 灌假事件 | 🟢 低 |

- [ ] 上表為**單一清冊**，每加一個新 secret 就補一列（含分級）
- [ ] 確認 🔴/🟠 secret **從未進 git**：跑一次 `git log -p | grep` 掃歷史（或 GitHub secret scanning，見 §4）
- [ ] 確認 secret **不落 log**：webhook/對帳/寄信路徑不 `console.log` 金鑰或完整 raw payload
- [ ] Vercel env vars **不勾 "Plaintext"**（用 Encrypted）；`.env.local` 不進 git（`.gitignore` 已含）
- [ ] 截圖/貼設定給人時**遮罩 🔴/🟠 值**

---

## 3. 金鑰輪替程序

### 3.1 例行輪替（低頻，預防性）

- [ ] 🔴 級 secret 每 **6–12 個月**輪替一次（或人員/裝置變動時）
- [ ] 輪替 SOP 文件化：每個 secret 「在哪產新值 → 更新哪些地方 → 如何驗證 → 舊值何時失效」各一段

### 3.2 緊急輪替（洩漏應變，見 §8 劇本）

- [ ] **service role key**：Supabase Dashboard → 重新產生 → 更新 Vercel env＋`.env.local` → 重新部署 → 驗證寫入正常
- [ ] **ECPay HASH_KEY/IV**：綠界後台改金鑰（多需客服/正式流程）→ 更新 env → **立即打一筆真實小額交易驗 webhook 驗章通過**（T35 換正式金鑰時的驗收同款）
- [ ] **CRON_SECRET / RESEND / Upstash**：各自平台重產→更新 env→重部署→驗證對應功能

> ⚠️ ECPay 金鑰輪替與 T35（換正式金鑰）綁定，一併定案正式版 SOP。

---

## 4. 依賴安全（供應鏈）

- [ ] 啟用 **GitHub Dependabot alerts**（repo Settings → Code security）——CLAUDE.md 說「安全漏洞才升級」，但目前沒有任何機制會**通知**有漏洞（Claude 產設定檔）
- [ ] （選）啟用 **Dependabot security updates**（自動開 PR 修漏洞）；本專案「不主動升級」原則下，改為只收 alert、人工評估後升
- [ ] 啟用 **GitHub secret scanning ＋ push protection**（擋把金鑰 push 上去）
- [ ] 例行 `pnpm audit`（或掛進 CI 當非阻斷 job）——記錄基準，之後看新增漏洞
- [ ] lockfile 進 git、CI 用 `--frozen-lockfile`（已有）；不用 `@canary/@beta/@rc/@next`（CLAUDE.md 已鎖）

---

## 5. 平台級防護：Vercel WAF ＋ BotID

程式層限流（OTP/cart/createOrder/付款重試）擋得住**邏輯濫用**，但擋不住大量 bot 流量、DDoS 騷擾、刷卡測試。補平台級這一層。

### 5.1 Vercel WAF（Firewall）

> 設定於 Vercel Dashboard → Firewall，或 `vercel.ts`/`vercel firewall` CLI。詳細語法見 `vercel:vercel-firewall` skill。

- [ ] 確認 **自動 DDoS 緩解**已啟用（Vercel 預設開，確認方案涵蓋）
- [ ] 建 **rate-limit 規則**（edge 層，先於 function）：對高風險路徑設每 IP 速率上限
  - `/api/ecpay/notify`：只允許綠界來源特徵/合理頻率（webhook 不該被大量外部打）
  - `/checkout/*`、登入 `requestOtp` 對應路徑：補 edge 限流（與應用層 Upstash 限流雙層）
- [ ] 建 **封鎖規則**：明顯惡意 IP/地區（若營運僅台灣，可考慮地區限制——先評估對正常客人的影響）
- [ ] 評估啟用 **Managed Ruleset**（OWASP 類）——先用 log/observe 模式觀察誤傷，再切 block
- [ ] 熟悉 **Attack Mode**（遭攻擊時一鍵對所有訪客上挑戰）——寫進 §8 應變劇本，知道在哪按
- [ ] 規則先上 **staging/preview 觀察**，確認不誤傷正常結帳流程再套 production

### 5.2 Vercel BotID

> BotID＝隱形 bot 偵測（GA 2025-06），保護關鍵動作免於自動化濫用。整合需程式（`@vercel/botid`）→ 碰 checkout/login 路徑 → **plan mode**。

- [ ] 安裝 `@vercel/botid`，在**關鍵動作**做伺服器端 bot 檢查：
  - **結帳建單** `createOrder`（防灌單、刷卡測試）
  - **登入 `requestOtp`**（防自動化撞信箱/耗 OTP 額度）
  - （評估）售後申請送出
- [ ] bot 判定命中時的處置：拒絕/挑戰，並記 Sentry（與現有限流訊號分流）
- [ ] 確認 BotID 不誤傷正常客人（尤其行動裝置/隱私瀏覽器）——先 observe 再 enforce
- [ ] BotID **不取代**應用層限流與驗價紅線——是**額外一層**，不是替代

---

## 6. 監控與稽核

- [ ] 確認 Sentry **P0 告警規則**已設（金流關鍵訊息：`ensureOrderPaid failed`／`訂單狀態更新失敗`／`money received on closed order`／`amount mismatch`／連續 403 憑證疑失效）——見 ops-runbook §1
- [ ] 為 **WAF/BotID 命中**與 **401（cron 非法呼叫）** 設低頻告警——異常尖峰＝有人在探
- [ ] **PII 稽核 log 留存**（T80 已落 `pii_access_log` 表）：確認可回溯查詢誰在何時看了收件人資料
- [ ] Vercel/Supabase/綠界的**登入活動**定期抽查（有無異地登入）

---

## 7. 定期節奏

| 頻率 | 動作 |
| ---- | ---- |
| **每次動綠界後台設定/換金鑰後** | 立刻打一筆真實小額交易驗 webhook 到達＋驗章通過（§3.2） |
| **每次加新 secret / 新表 / 新 API 路徑** | 補 §2 清冊；新表確認 RLS（security-foundation 漂移檢核會抓） |
| **每週三** | `/security-foundation` 程式地基漂移檢核（已排程） |
| **每月** | 掃 Dependabot alerts；抽查各 Dashboard 登入活動與協作者名單 |
| **每季** | 檢視 WAF 規則誤傷/命中統計；評估 BotID observe→enforce |
| **每 6–12 月 / 人員裝置變動** | 🔴 級 secret 例行輪替（§3.1） |

---

## 8. 洩漏/入侵應變劇本

**懷疑某 secret 外洩時（立即，依爆炸半徑排序）：**

1. **service role key 疑外洩** → 立刻走 §3.2 輪替；輪替前先到 Supabase 看**異常查詢/大量讀取**；必要時暫時收緊 RLS/停用對外寫入路徑。
2. **ECPay HASH_KEY/IV 疑外洩** → §3.2 輪替＋通知綠界；比對近期 `payment.raw_callback` 有無金額不符/非預期 TradeNo（對帳稽核臂會抓 `amount mismatch`）。
3. **`ADMIN_EMAIL` 信箱疑被盜** → 立刻改該信箱密碼＋踢除所有 session＋開/重設 2FA；檢查後台是否有非本人操作（`order_status_log` 的 override 紀錄）。
4. **遭 DDoS/大量濫用** → Vercel Firewall 開 **Attack Mode**；必要時加臨時封鎖規則。
5. 任何一次應變後：**寫進 work-log／本檔 §8**，並自問「這是個案還是 pattern？該自動化哪一步？」（coding-system §3.5）。

> 帳務表永禁 DELETE（ops-runbook 紅線）；應變期間的任何資料修復走 ops-runbook 的權威順序（綠界＞payment＞orders＞通知），不反向。

---

> **交叉參考**：`security-foundation.md`（程式地基漂移）、`ops-runbook.md`（金流人工救援）、`launch-scope.md`（上線分級）、`architecture.md` §8（Gap）；相關任務 T82（環境分離）、T34（DB 備份）、T35（正式金鑰）、T139（Google OAuth 帳號）。
