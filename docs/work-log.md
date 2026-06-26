# work-log.md — incantochen 工作日誌

> 路徑：`jewelry-shop/docs/work-log.md`  
> 用途：每次作業前填「本次」、結束前填「下次」，讓 Claude Chat 與 Claude Code 快速接手。  
> 格式：每節一個任務區塊，狀態用 emoji（✅完成 ⏳進行中 ⬜未開始 ⏭️跳過 ⚠️阻塞）

---

## 📅 2026-06-25

### 本次作業

#### #文件整理 / 規劃工具
**說明**：將 MVP 開發任務清單 xlsx 轉為 CSV；建立文件目錄索引與工作日誌範本。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成 |
| 產出 | `docs/tasks.csv`、`docs/decisions.csv`、`docs/sprint_overview.csv`、`docs/docs-index.md`、`docs/work-log.md` |
| 更新描述 | tasks.csv 以最新版 xlsx 轉換（P01–P05 狀態已完成）；累積人天為實際數值。docs-index.md 列出兩個目錄位置的所有文件與用途。CLAUDE.md 補入文件目錄引用。 |
| 待辦 | 將產出檔案放入 `jewelry-shop/docs/`；在 CLAUDE.md 最上方加入 docs-index 引用一行。 |

---

#### #T43 / M0 資料 / dev seed
**說明**：建立本機開發種子資料，供 M1 戒指配置器開發使用。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（Claude Chat 產出＋Claude Code 本機驗收通過，2026-06-25） |
| 產出 | `supabase/seed.sql`、`docs/verify-seed.sql`（修正版） |
| 更新描述 | 以 CTE + ON CONFLICT DO NOTHING 冪等設計寫入 seed.sql。內容：1 款戒指（emerald-solitaire-ring，底價 NT$25,000）、3 個 OptionType（gem_color/metal_color/ring_size）、8 個 OptionValue（3 寶石色/2 金屬色/3 戒圍）、3 個 ProductOption、8 個 ProductOptionValue（含 price_delta 與 is_default）。使用固定 UUID，可重複執行，末尾 SELECT 顯示各步驟插入數量供驗收。本機跑 `supabase db reset --local` 套用，發現並修正 bug：`option_type` 表無 `sort_order` 欄位，seed.sql／verify-seed.sql 誤用，已移除該欄位引用。此 CLI 版本（2.107.0）無 `db seed`／`db execute` 子指令，改用 `supabase db query --local "<sql>"` 逐條驗收（含 enum 欄位 `::text` 轉型繞過掃描限制）。驗收結果全數通過（products=1, option_types=3, option_values=8, product_options=3, product_option_values=8；白名單與完整性查詢符合預期）。 |
| 待辦 | （無，已完成） |
| 依賴 | T03 ✅、T46 ✅ |

---

#### #T04 / M0 基礎建設 / 部署到 Vercel 並打通 CI
**說明**：插隊任務（M1 主線之外），在開始 T15 前先確保部署/CI 基礎設施就位，降低後期金流整合風險。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | GitHub repo `github.com/incantochen/incantochen`、Vercel 專案 `jewelry-shop` |
| 更新描述 | 1. repo 原本無 git remote，新增 origin 並 push 既有 commit。2. `vercel link` 建立專案，但自動連接 GitHub 失敗兩次：先缺帳號層級 Login Connection，補上後仍缺 GitHub App 對該 repo 的存取授權（需在 GitHub Installed GitHub Apps 設定，非單純 OAuth 登入連線）；安裝 Vercel GitHub App 並勾選 Commit Comments、Consolidated Commit Status 權限後，`vercel git connect` 顯示 already connected（CLI 對「已連接」狀態回傳 exit code 1，屬已知 UX 瑕疵，非錯誤）。3. Supabase 環境變數（`NEXT_PUBLIC_SUPABASE_URL`／`NEXT_PUBLIC_SUPABASE_ANON_KEY`，特別注意要用 anon/public key、不可用 service_role/secret key）由使用者本人直接於 Vercel Dashboard 設定，未經過 Claude（依 `.env*` 紅線）。4. `vercel --prod` 完成首次部署成功。5. 用空 commit push 驗證 CI：30 秒內自動觸發新 production 部署，確認 git push 自動部署生效。 |
| 待辦 | （無，已完成）。正式網域待 T35 上線階段再設定（目前用 Vercel 預設 `*.vercel.app` 子網域，與最終正式網址無關，可隨時換） |
| 驗收 | production：`https://jewelry-shop-delta.vercel.app`（Ready） |
| 依賴 | T01 ✅ |

---

#### #T52 / M0 流程 / Staging 環境（Vercel preview）
**說明**：插隊任務，緊接 T04 驗證 Vercel 分支預覽機制，留給日後 ECPay sandbox 等金流測試用固定網址。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | git 分支 `staging` |
| 更新描述 | 建立並 push `staging` 分支，確認 Vercel 自動產生 Preview（非 Production）部署；該分支有穩定別名（不隨每次部署變動），可作為金流回拋網址等固定測試端點。 |
| 待辦 | （無，已完成） |
| 驗收 | preview 穩定別名：`https://jewelry-shop-git-staging-fishead02290-3279s-projects.vercel.app` |
| 依賴 | T04 ✅ |

---

#### #T05 / M0 會員 / Supabase Auth 設定（Email OTP 主＋Magic link 輔）
**說明**：插隊任務（涉及 auth，先進 plan mode 核准後執行）。設定 Auth provider 讓 T06 登入 UI 開工前就位；範圍僅 redirect 白名單與 email 樣板，不含 `/auth/confirm` 頁面與登入 UI 本身。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 本機完成（2026-06-25）；⚠️ production 待使用者手動設定 |
| 產出 | `supabase/config.toml`（修改）、`supabase/templates/magic_link.html`（新增） |
| 更新描述 | 1. 修正 `additional_redirect_urls` 協定不一致 bug（原 `https://127.0.0.1:3000`，與 `site_url` 的 `http://` 不一致），改為 `["http://127.0.0.1:3000/**", "http://localhost:3000/**"]`。2. 新增 `[auth.email.template.magic_link]` 自訂樣板，內容顯示 6 碼 OTP（`{{ .Token }}`）＋連結改指向自家 `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`（而非 Supabase 預設直接驗證的端點），符合 user-flow.md「連結落地頁須再按一次登入才消耗 token」的防護需求。3. `content_path` 路徑解析是相對於專案根目錄（cwd），不是相對於 `supabase/config.toml` 所在目錄——首次寫成 `./templates/...` 會找不到檔案，需寫 `./supabase/templates/...`（沿用既有 `invite` 註解範例的寫法）。4. `supabase stop`＋`start` 重啟套用設定。5. 端到端驗證：`POST /auth/v1/otp` 觸發信→Mailpit 確認信件主旨／OTP 碼／連結格式全部正確→`POST /auth/v1/verify` 用該 OTP 碼成功換得 access token。 |
| 待辦 | **production（cloud project `wdmigbqdhernmrfpzzxk`）尚未設定，需使用者手動到 Supabase Dashboard**：① Authentication → URL Configuration：Site URL 設 `https://jewelry-shop-delta.vercel.app`，Redirect URLs 新增 `https://jewelry-shop-delta.vercel.app/**` 與 `https://jewelry-shop-git-staging-fishead02290-3279s-projects.vercel.app/**`。② Authentication → Emails → Magic Link：貼上 `supabase/templates/magic_link.html` 的內容（`{{ .SiteURL }}` 在雲端會自動解析成正式網址，不用改）。 |
| 驗收 | 本機 Mailpit 收信內容：OTP 碼正確顯示、連結正確指向 `/auth/confirm`；`verify` API 成功換 token。production 端到端測試留待 T06（登入 UI／`/auth/confirm` 頁面）完成後再做。 |
| 依賴 | T02 ✅ |

---

#### #T15 / M1 前台 / 戒指商品詳情頁（骨架）
**說明**：以種子資料開發戒指商品詳情頁（PDP）骨架，路由 `/products/[slug]`，為配置器（T16）做地基。涉及多檔案＋設計決策，先進 plan mode 核准後執行。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | `src/app/products/[slug]/page.tsx`（新增）、`src/components/site-header.tsx`（新增）、`src/components/site-footer.tsx`（新增）、`src/app/layout.tsx`（修改，接入 header/footer） |
| 更新描述 | 1. **Wireframe 落差**：`docs/wireframe/` 實際不存在（memory.md 記載有誤），改用使用者指出的備份 HTML demo `backup/_backup_docs_20260624_235506/proj-docs/Demo/Demo_0623/product.html` 當版面參考。2. 該 demo 是「完工狀態」（含配置器互動／即時換圖／即時計價／加入購物袋），T15 範圍縮小為骨架：麵包屑、圖片佔位（lucide `Gem` icon）、商品名稱／類別／預設選配價格、三組選項以**靜態 chip** 呈現（標出 `is_default`，無 `onClick`）、交期告知（`XX` 佔位，天數未定為已知待辦）、靜態「加入購物袋」按鈕。3. **刻意省略**「關於這件作品／材質與保養」「猜你喜歡」——`product` 表無描述欄位、seed 僅 1 款商品，不杜撰假內容/假商品卡。4. 資料撈取：Server Component 用 `createClient()`＋ Supabase 巢狀 `select`（`product_option → option_type` ＋ `product_option_value → option_value`）一次撈三層白名單；找不到商品走 `notFound()`。5. Tailwind token 與 wireframe CSS 變數高度重合（`--emerald`→`primary`、`--gold`→`secondary-400`、`paper/cloud/stone/ash/ink` 同名），幾乎無需另定顏色。6. 新增 `SiteHeader`／`SiteFooter` 共用元件接入 root layout，避免之後每頁重複搭（純靜態，無購物車數量／登入狀態，留給 T07/T08/T20/T21 接資料）。7. **環境問題排查**：`pnpm dev` 開發時 PDP 一直 404，原因是 `.env.local` 的 `NEXT_PUBLIC_SUPABASE_URL` 指向**雲端 production**而非本機，T43 seed 當時只下在本機 `supabase db reset --local`，雲端 `product` 表是空的；已用 `supabase db query --linked --file supabase/seed.sql` 把同一份 seed（固定 UUID＋`ON CONFLICT DO NOTHING`，重複執行安全）也套到雲端，問題排除。8. 用 Playwright（`npx playwright install chromium`，無 `chromium-cli` 故用 `_electron` 模式改寫的純 `chromium.launch()` 腳本）截圖驗證：正常 slug 顯示完整骨架且樣式正確、假 slug 正確回 404、無 console error。9. 修正一處小 bug：類別 eyebrow 標籤原寫 `categoryLabel.toUpperCase()`（中文呼叫 toUpperCase 無效，顯示「戒指 · 戒指」），改用 `product.category`（英文 code）+ CSS `uppercase` class，正確顯示「RING · 戒指」。 |
| 待辦 | （無，已完成）。之後若要再加測試/示範資料，記得本機＋雲端都要各跑一次 seed（見 CLAUDE.md 頂部環境提醒）。 |
| 驗收 | `pnpm lint` 通過、`tsc --noEmit` 無型別錯誤；Playwright 截圖確認 `/products/emerald-solitaire-ring` 正常渲染、`/products/not-a-real-slug` 回 404。 |
| 依賴 | T43 ✅、T39 ✅（基礎部分） |

---

#### #T16 / M1 配置器 / 配置器 UI（戒指選項）
**說明**：把 T15 的靜態選項 chip 變成可互動配置器——點擊切換選取、狀態管理。先進 plan mode 簡單規劃後執行。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | `src/components/product-configurator.tsx`（新增，client component）、`src/app/products/[slug]/page.tsx`（修改） |
| 更新描述 | 1. 把選項 chip／數量 stepper／CTA 按鈕從 page.tsx 抽到新的 client component，定義乾淨的 `ConfiguratorOption` 型別（不直接帶 Supabase 生成型別進 client，page.tsx 負責把巢狀資料整理成這個形狀再傳入）。2. `selected` 用 `Record<optionId, valueId>`，初始值取各 option 的 `isDefault`；`quantity` 用 `useState(1)`，stepper `-` 在 1 時 disabled。3. **價格刻意不隨選取或數量連動**——維持 T15 的靜態 `startingPrice`，這是 tasks.csv 的任務切分（T18 報價引擎才負責即時計價），不是漏做。4. Playwright 驗證：點「藍寶石」「18K 白金」chip 後樣式正確切換選中（祖母綠/18K黃金正確取消選中）、戒圍維持預設未受影響、stepper +兩次數量正確變 3、無 console error。 |
| 待辦 | （無，已完成） |
| 驗收 | `pnpm lint`／`tsc --noEmit` 通過；Playwright 點擊後截圖確認選取狀態與數量正確。 |
| 依賴 | T15 ✅ |
| 注意 | 白名單驗證仍以伺服器資料為準，前端互動只是 UI 狀態，不得讓使用者選到白名單外的值（目前資料來源即為白名單查詢結果，無繞過風險） |

---

#### #T17 / M1 配置器 / 選項即時換圖
**說明**：選項變動時主圖即時切換（搭配 T55 疊圖機制，T56 3D 素材未完成前先用現有 placeholder 邏輯延伸）。

| 項目 | 內容 |
|------|------|
| 狀態 | ⏸️ 暫緩 |
| 更新描述 | 與使用者討論過是否拆獨立小專案處理圖片素材（技術研究/規劃/執行），結論：維持 T55/T56 的 3D Blender 路線；也評估過用 AI 圖片生成模型（DALL-E／Imagen 等）代替，判定不適合——生成式模型無法做到「同一戒指模型、精準替換材質、像素級對齊」，AI 圖片生成較適合輔助生情境照（配戴/生活照），不適合主圖配置器。T17 真正依賴 T55/T56，兩者都還沒開始，先擱置，PDP 用佔位圖頂著。 |
| 待辦 | 待 T56（3D 素材）／T55（疊圖機制）任一方有進度後再細化 |
| 依賴 | T16 ✅、T55（尚未開始）、T56（尚未開始） |
| 注意 | MVP 不做 3D 即時預覽；本任務範圍是「依選項換靜態合成圖」，非 3D 渲染 |

---

#### #T18 / M1 報價 / 報價引擎（即時計價）
**說明**：把 T16 的選取狀態接上即時計價公式，price 隨點擊/數量變動。T17 暫緩後改做不依賴圖片素材的這個任務。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | `src/components/product-configurator.tsx`（修改）、`src/app/products/[slug]/page.tsx`（修改） |
| 更新描述 | 1. `ConfiguratorOption.values` 加上 `priceDelta` 欄位；新增 `basePrice` prop。2. 公式依 `docs/data-model.md` §4.2 既有契約：`unit_price = base_price + Σ(已選 price_delta)`；`小計 = unit_price × quantity`。3. 把原本在 `page.tsx` 的靜態價格顯示移進 `ProductConfigurator`（因為要跟 `selected`/`quantity` state 連動，server component 無法持有這個 state）。4. 補回 wireframe 原有的「加價明細 ▾」展開面板（T15 時刻意跳過，因為當時沒有真互動可以撐這個面板；現在 T16/T18 都做完了，補上不算超範圍）。5. Playwright 驗證：選紅寶石(+3000)/18K白金(+1000)後單價由 25,000 即時變 29,000；數量改 2 後明細面板小計正確顯示 58,000（29,000×2）；無 console error。 |
| 待辦 | （無，已完成）。伺服器端驗價（T41）仍是獨立任務——前端這裡的計算只供顯示，下單時一律後端依白名單重算。 |
| 驗收 | `pnpm lint`／`tsc --noEmit` 通過；Playwright 截圖確認價格與明細數字正確。 |
| 依賴 | T16 ✅ |

---

#### #T19 / #T20 / M1 報價＋購物車 / 規格＋金額快照結構 ＋ 加入購物車（寫快照）
**說明**：把 T18 算出來的選取狀態接成真的寫進 `cart`／`cart_item`。涉及 service role key（RLS 故意對前台全拒）與訪客身份識別，先進 plan mode 規劃。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | `src/lib/supabase/service-role.ts`（新增）、`src/app/products/[slug]/actions.ts`（新增）、`src/components/product-configurator.tsx`（修改）、`src/app/products/[slug]/page.tsx`（修改） |
| 更新描述 | 1. **新建 service role client**（`service-role.ts`，`import "server-only"` 防呆，client component 誤用會編譯期報錯）——`cart`／`cart_item` 的 RLS policy 故意對 anon/authenticated 全拒，只有 service role 能寫，這是 schema 設計階段就定案的，不是本次新決策。2. **`addToCart` server action**：前端只送 `productId`／選中的 `product_option_value.id` 陣列／`quantity`，**完全不送價格**；action 內用既有 anon client 重新查 `product_option`/`product_option_value` 白名單，驗證每個必填選項恰好選一個值、用查到的 `price_delta` 重新算 `unit_price_snapshot`，組出符合 `docs/data-model.md` §4.2 契約的 `config_snapshot`（product_id/base_price/selections[]/line_unit_price）——對齊「伺服器端驗價」紅線精神，T41 是結帳流程的完整版本，這裡是資料寫入的第一道關卡。3. **訪客身份**：`guest_token` httpOnly cookie（90 天，sameSite lax）；find-or-create `cart`，再插入 `cart_item`。4. **新環境變數 `SUPABASE_SERVICE_ROLE_KEY`**：專案原本完全沒設定，使用者親自到 Supabase Dashboard 的 API Keys 頁面（介面改版過，不在原本的 Data API 頁籤下）拿到後，自己填進本機 `.env.local` 與 Vercel，全程未經過 Claude。5. 按鈕改用 `useTransition` 呼叫 server action，成功顯示「已加入購物袋」、失敗顯示錯誤訊息。6. 雙重驗證：Playwright 點擊後看到成功提示＋`guest_token` cookie 正確設定；另用 `supabase db query --linked` 直查雲端 production 的 `cart_item`，確認 `unit_price_snapshot`（伺服器重算的 27000，不是前端算的）與 `config_snapshot` 形狀完全正確。 |
| 待辦 | （無，已完成）。會員車合併留給 T22「結帳即會員」；購物車頁面本身是 T21。 |
| 驗收 | `pnpm lint`／`tsc --noEmit` 通過；Playwright＋雲端 DB 查詢雙重確認資料正確寫入且價格未被前端污染。 |
| 依賴 | T18 ✅ |

---

#### #T21 / M1 購物車 / 購物車頁
**說明**：讀剛剛寫進去的 `cart_item`，做出購物車頁面——項目列表、改數量、刪除、小計。涉及 service role 讀取＋擁有權檢查，先進 plan mode 規劃。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | `src/lib/cart/read-cart.ts`（新增）、`src/app/cart/actions.ts`（新增）、`src/app/cart/page.tsx`（新增）、`src/components/cart-item-row.tsx`（新增）、`src/components/site-header.tsx`（修改） |
| 更新描述 | 1. **讀取也要走 service role**——T19/T20 只處理了寫入，這次發現 `cart`／`cart_item` 的 RLS 是「啟用但完全不建 policy」，deny-by-default 對**所有操作**生效，連 SELECT 也不例外，所以 `read-cart.ts` 一樣得用 service role client。2. **新增 T19/T20 沒有的風險：擁有權檢查**——改數量／刪除收到的是 `cart_item.id`，如果不驗證歸屬，任何人猜到別人的 id 就能改/刪別人的購物車；`verifyOwnership()` 先查該 `cart_item` 所屬 `cart.guest_token`，跟當前請求的 cookie 比對一致才放行，不一致就回錯誤、不執行任何寫入。3. Wireframe 參考 `Demo_0623/cart.html`：兩欄版面（左品項列表＋右摘要面板 sticky），`config_snapshot.selections[].label` 串成 gemline 摘要文字。4. 「前往結帳」按鈕做成 `disabled`（`/checkout` 是 T22，避免連到 404）；header 購物袋數量徽章不做（非本任務範圍，需每頁查 DB）。5. `site-header.tsx` 的購物袋圖示連結從 `#` 改成 `/cart`。6. Playwright 全流程驗證：PDP 加入商品→開 `/cart` 確認顯示正確→點 `+` 改數量(2)，畫面與小計即時反映→點「移除」回到空車狀態；另外直查雲端 production 的 `cart_item` 數量，確認新建/改/刪都是真的反映在資料庫（不是只有前端樂觀更新），剩餘資料是更早 T19/T20 測試留下的舊資料，時間戳與 guest_token 都對得上。 |
| 待辦 | （無，已完成）。 |
| 驗收 | `pnpm lint`／`tsc --noEmit` 通過；Playwright 截圖＋雲端 DB 查詢雙重確認。 |
| 依賴 | T19/T20 ✅ |

---

#### #T06 / #T07 / M1 會員 / 登入入口（Email OTP／Magic Link）＋ 登入狀態與路由保護
**說明**：插隊任務（使用者要求先做完登入再回頭做 T22）。涉及 auth／session，先進 plan mode 規劃。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | `src/lib/auth/find-or-create-member.ts`、`src/lib/auth/require-user.ts`、`src/app/login/actions.ts`、`src/app/login/page.tsx`、`src/app/auth/confirm/actions.ts`、`src/app/auth/confirm/page.tsx`、`src/app/account/actions.ts`、`src/app/account/page.tsx`（新增）、`src/proxy.ts`（新增）、`src/components/site-header.tsx`（修改） |
| 更新描述 | 1. **規格依據**確認真實案例：Notion 信件同時放 magic link＋備用驗證碼、Supabase 官方文件建議的樣板客製化方向、Outlook Safe Links 預先 GET 連結的已知問題與業界標準解法（落地頁需再按一次才消耗 token），三者疊起來就是這次的設計依據，不是憑空想的。2. **關鍵發現**：`member` 表（`supabase/migrations/0002...sql`）只有 `member_select_own` 這條 SELECT policy，沒有 INSERT policy，也沒有 `auth.users` insert trigger；驗證成功後建立 `public.member` row 一樣會被 RLS 擋，跟 T19/20/21 的 `cart` 一樣得走 service role（`find-or-create-member.ts`）。3. `src/proxy.ts` 是 Next.js 16 取代 `middleware.ts` 的新慣例：實測 `node_modules/next/dist/build/templates/middleware.js` 原始碼確認檔名比對邏輯（`page === '/proxy' \|\| page === '/src/proxy'`）與必須具名匯出 `proxy`（不是 `middleware`，否則拋 `ProxyMissingExportError`），不是憑空猜的。4. `/auth/confirm` 落地頁刻意**不在 `useEffect` 自動驗證**，必須等使用者按下按鈕才呼叫 `confirmMagicLink`，對齊 user-flow.md 的防呆需求。5. `/account` 只做最小版本（`requireUser()`＋歡迎訊息＋登出），會員中心本體留給 T08 擴充，不是用過即丟。6. **抓到一個真實 bug**：用 `supabase.auth.admin.generateLink` 產生測試用驗證碼時發現，**雲端 production 實際送出的 OTP 是 8 位數**，但 `verifyOtpCode` 跟 `/login` 表單原本寫死「剛好 6 位數字」（`/^\d{6}$/`、`maxLength={6}`）——這個假設來自本機 `supabase/config.toml` 的 `otp_length = 6`，但那只管本機，雲端 cloud 專案的實際值不同，跟 T05 當時學到的「本機設定≠雲端設定」是同一類陷阱。已改成不假設固定長度（`/^\d{4,10}$/`、`maxLength={10}`）。7. **驗證方法**：`.env.local` 接雲端 production，OTP 信會寄到真實信箱（無法像本機 Mailpit 直接讀信內容）；改用 `supabase.auth.admin.generateLink()`（service role，不寄真信）直接取得測試用 `email_otp`／`hashed_token`，對實際 `/login`、`/auth/confirm` 頁面跑 Playwright 全流程；另發現對全新 email 用 `admin.generateLink({type:"magiclink"})` 時 Supabase 會內部歸類成 `verification_type: "signup"`（不是 `magiclink`），對已存在的使用者才會正確回 `magiclink`——所以測試改用 `admin.createUser` 先建好測試帳號再產生連結。8. 驗證完成後用 `admin.listUsers`／`admin.deleteUser` 清掉所有 `t06-*@example.com` 測試帳號，production 資料庫沒有殘留垂圾資料。 |
| 待辦 | （無，已完成）。 |
| 驗收 | `pnpm lint`／`tsc --noEmit`／`pnpm build` 全通過（`proxy.ts` 在 build 輸出正確顯示為 `ƒ Proxy (Middleware)`）。Playwright 端到端：①未登入訪問 `/account` 導向 `/login`。②`/auth/confirm` 落地頁先顯示確認按鈕（未自動消耗 token），按下後才登入成功導向 `/`。③登入後 `/account` 正確顯示歡迎訊息（`member` row 經 DB 查詢確認已建立）。④登出後重訪 `/account` 又被導回 `/login`。 |
| 依賴 | T05 ✅ |

---

---

#### #T22 / M1 結帳 / 結帳頁（收件＋配送）
**說明**：購物車頁已經有「前往結帳」按鈕（目前 disabled），T22 要把它接上真正的結帳頁。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-25） |
| 產出 | `src/app/checkout/page.tsx`（新增）、`src/components/checkout-form.tsx`（新增）、`src/lib/checkout/schema.ts`（新增） |
| 更新描述 | `/checkout`（讀 T21 `getCart()`，空車導回 `/cart`）＋`checkout-form.tsx`（Zod 驗證）。重要釐清：結帳本身不需要 OTP/magic link，Email 只是輸入框，「結帳即會員」留給 T23 在背景處理。依使用者要求查證 ECPay 文件：付款 API 不需收件人資料；黑貓宅配物流 API 需要獨立的郵遞區號欄位，已補進表單。送出按鈕 disabled（待 T23/T48/T57）。Playwright 驗證通過。 |
| 待辦 | （無，已完成） |
| 依賴 | T21 ✅、T06/T07 ✅ |

---

## 📅 2026-06-26

### 本次作業

#### #T57 / M1 法務 / 客製例外告知與同意（結帳）
**說明**：結帳頁加入「客製商品注意事項」告知區塊與必填同意 checkbox，勾選才能繼續。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-26） |
| 產出 | `src/lib/checkout/schema.ts`（修改）、`src/components/checkout-form.tsx`（修改）、`eslint.config.mjs`（修改） |
| 更新描述 | 1. **無需新增 migration**：`orders` 表的 `0001_initial_schema.sql` 原已含 `custom_consent bool` 與 `consent_at timestamptz` 欄位（T57 標注），規劃時已預留。2. `checkoutFormSchema` 加入 `customConsent: z.literal(true, { message: "..." })`——Zod v4 的正確寫法是直接在第二個參數傳 `{ message }` 物件，不用 `errorMap`。3. `checkout-form.tsx` 加入 `customConsent` state（初始 `false`）；checkbox 改用 `onBlur={validate}` 觸發驗證（與其他欄位一致），避免 onChange 直接呼叫 validate 讀到 stale closure 的問題。4. 法律文字為草稿佔位，加 TODO 標注，上線前以律師審定版取代（T36）。5. 同意時間戳記寫入（`consent_at`）留給 T23 建立訂單時處理。6. 順帶修正 `eslint.config.mjs` 加入 `.claude/**` ignore，修正 pre-existing lint 錯誤（ECPay skill test 檔案用 CommonJS require() 被 TS-ESLint 擋）。 |
| 待辦 | （無，已完成） |
| 驗收 | `pnpm lint` ✅、`pnpm tsc --noEmit` ✅；commit `f8e5c79`，merge commit `01f971d`。 |
| 依賴 | T22 ✅ |

---

---

#### #T23 / M1 訂單 / 建立訂單（待付款）
**說明**：把結帳表單接上後端：建立 `orders`+`order_item`→靜默結帳即會員→清購物車→成功頁。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-26） |
| 產出 | `supabase/migrations/0003_add_zip_code_to_orders.sql`（新增，已 db push）、`src/app/checkout/actions.ts`（新增）、`src/app/checkout/success/page.tsx`（新增）、`src/components/checkout-form.tsx`（修改，送出按鈕啟用） |
| 更新描述 | 1. Migration 0003：`orders` 表加 `zip_code text`（nullable），已套用至雲端；`gen types` 重新生成，`as any` 移除。2. `createOrder` server action：① server-side Zod 驗證 ② service role 讀購物車 ③ 訪客「結帳即會員」（查 `member` 表 by email → 不存在則 `admin.createUser` 靜默建立）④ 計算金額（`shipping_fee=0` T48 暫緩）⑤ `order_no` 格式 `INC-YYYYMMDD-6隨機英數`，碰撞自動 retry ⑥ INSERT orders→order_item（快照複製，不重算）→DELETE cart（CASCADE 清 cart_items）⑦ redirect 至成功頁。3. `/checkout/success` 頁顯示訂單號＋「可用此 Email 登入查詢」提示。4. `checkout-form.tsx` 送出按鈕從 `disabled` 改為 `useTransition` 接 server action。 |
| 待辦 | （無，已完成） |
| 驗收 | `pnpm lint` ✅、`pnpm tsc --noEmit` ✅；feat/t23-create-order rebase onto master → merge commit `e4bdc24` |
| 依賴 | T22 ✅、T57 ✅ |

---

#### #購物車徽章 / Header / 購物袋圖示數量徽章
**說明**：加入購物車後，header 購物袋圖示右上角顯示紅色數字徽章。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-26） |
| 產出 | `src/lib/cart/get-cart-count.ts`（新增）、`src/components/site-header.tsx`（修改）、`src/components/product-configurator.tsx`（修改） |
| 更新描述 | 1. `getCartCount()`：讀 `guest_token` cookie → service role 查 `cart_item` count（`count: "exact", head: true`）。2. `SiteHeader`：`CartIconWithBadge` async Server Component，數量 > 0 顯示紅色圓圈，>9 顯示 `9+`；以 `Suspense` 包裹，不阻礙頁面渲染，fallback 為無徽章購物袋。3. `ProductConfigurator`：`addToCart` 成功後加 `router.refresh()`，觸發 Server Component 重新讀取 → 徽章即時更新，client component state（選配/數量）不受影響。 |
| 待辦 | （無） |
| 驗收 | `pnpm lint` ✅、`pnpm tsc --noEmit` ✅；commit `0fd3682`，merge `bd5fc04` |
| 依賴 | T20 ✅ |

---

#### #T24 / M1 金流 / ECPay sandbox 設定
**說明**：安裝 ECPay 官方知識庫、實作 CheckMacValue 簽章、驗證 sandbox 連線。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-26） |
| 產出 | `.claude/skills/ecpay`（安裝官方 ECPay-API-Skill）、CheckMacValue 實作與測試向量驗證 |
| 更新描述 | 1. 安裝官方 ECPay-API-Skill 至 `.claude/skills/ecpay`，問 ECPay API 問題會自動查到正確規格。2. CheckMacValue 簽章演算法對官方 8 組測試向量全數通過（金流 SHA256／物流 MD5 不可混用）。3. sandbox 連線測試：`MerchantID=3002607` 送出請求，收到正確付款頁。**踩坑**：① Bash shell 傳中文參數給 curl 編碼失真→T25 必須用 Node `fetch()`/`URLSearchParams` 直送。② 此環境 IPv6 連 sandbox 會被重置→強制 IPv4（`NODE_OPTIONS=--dns-result-order=ipv4first`）。 |
| 待辦 | （無，已完成） |
| 依賴 | T02 ✅ |

---

### 下次作業

#### #T48 / M1 金流 / 綠界黑貓宅配串接（保價＋本人簽收）
**說明**：物流策略未定，暫緩。

| 項目 | 內容 |
|------|------|
| 狀態 | ⏸️ 暫緩（2026-06-26） |
| 更新描述 | 物流策略尚未確定：① 直接用綠界 API 串台灣物流 ② 可能從飾品原產地直接宅配到消費者端。兩者運費計算方式差異大，待使用者確認後再細化。T23 建立訂單時 `shipping_fee` 先填 `0`（`orders` 表已有 `default 0`），不阻礙骨架打通。 |
| 待辦 | 物流策略確認後再開工 |
| 依賴 | T22 ✅ |

---

#### #T25 / M1 金流 / 建立付款請求並導向 ECPay
**說明**：結帳成功後建立 ECPay 付款請求，產出 HTML form 並導向綠界付款頁。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-26） |
| 產出 | `src/lib/ecpay/check-mac-value.ts`、`src/lib/ecpay/aio-payment.ts`、`src/lib/env.server.ts`、`src/app/checkout/pay/page.tsx`、`src/app/api/ecpay/order-result/route.ts`、`src/components/ecpay-auto-submit.tsx`、`src/app/checkout/actions.ts`（修改）、`src/app/checkout/success/page.tsx`（修改）、`src/app/cart/page.tsx`（修改） |
| 更新描述 | 1. **`src/lib/ecpay/check-mac-value.ts`**：SHA256 CheckMacValue 生成（`generateCheckMacValue`）＋ timing-safe 驗證（`verifyCheckMacValue`），`import "server-only"` 防呆，ecpayUrlEncode 依規格還原 7 個 .NET 特殊字元。2. **`src/lib/env.server.ts`**：server-only ECPay 環境變數（`ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` / `ECPAY_PAYMENT_URL` / `NEXT_PUBLIC_SITE_URL`），分開於 `env.ts` 公開變數，避免汙染前端 bundle。3. **`src/lib/ecpay/aio-payment.ts`**：`buildAioParams()` 組裝 AIO 參數——`MerchantTradeNo` 去掉 hyphen（`INC20260626XXXXXX`，ECPay 限英數字 20 字）、Taiwan time 格式日期、`ItemName` 截斷 200 字、計算並附加 `CheckMacValue`；`ReturnURL` 佔位指向 T26 webhook endpoint。4. **`src/app/checkout/pay/page.tsx`**：SSR Server Component，service role 查訂單＋order_item + products，呼叫 `buildAioParams()`，渲染含所有 hidden input 的 ECPay form。5. **`src/components/ecpay-auto-submit.tsx`**：Client Component，`useEffect` 觸發 `form.submit()`——App Router 的 Server Component 不執行 `dangerouslySetInnerHTML` 裡的 `<script>` 標籤，需 client component 繞過。6. **`src/app/api/ecpay/order-result/route.ts`**：POST handler，ECPay 付款後 browser redirect 到此，讀 `MerchantTradeNo`/`RtnCode`，`RtnCode=1` 導向成功頁，否則導回 `/checkout/pay?error=payment_failed`；CheckMacValue 驗證留給 T26 ReturnURL webhook（這裡只是前端 redirect，不是安全關卡）。7. `createOrder` 步驟⑨ 從直接 redirect 成功頁改為 redirect 到 `/checkout/pay?order=...`；購物車「前往結帳」按鈕從 `disabled` 改為 `<Link href="/checkout">`。**使用者需在 `.env.local` 加入** `ECPAY_MERCHANT_ID=3002607`、`ECPAY_HASH_KEY=pwFHCqoQZGmho4w6`、`ECPAY_HASH_IV=EkRm7iFT261dpevs`、`ECPAY_PAYMENT_URL=https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5`、`NEXT_PUBLIC_SITE_URL=http://localhost:3000`。 |
| 待辦 | （無，已完成） |
| 驗收 | `pnpm lint` ✅、`tsc --noEmit` ✅；sandbox 端到端：加入購物車→結帳→自動跳 ECPay 沙盒付款頁→測試信用卡（4311-9522-2222-2222）→交易成功→導回 `/checkout/success` 顯示訂單號。branch `t25-ecpay-payment-redirect`，PR 待審 |
| 依賴 | T23 ✅、T24 ✅ |

---

#### #T26 / M1 金流 / ECPay 付款結果 Webhook（ReturnURL）
**說明**：實作 `/api/ecpay/notify` server-to-server callback，驗證 CheckMacValue 並更新訂單狀態＋插入 Payment 記錄。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-26） |
| 產出 | `src/app/api/ecpay/notify/route.ts`（新增） |
| 更新描述 | POST handler：① 解析 form data ② verifyCheckMacValue（SHA256，安全關卡）③ 查 orders by order_no（MerchantTradeNo 還原 hyphen）④ 冪等：payment 已 paid 直接回 1\|OK ⑤ RtnCode=1：upsert payment(paid) + orders.status pending_payment→paid ⑥ RtnCode≠1：upsert payment(failed) ⑦ 無論如何回 HTTP 200 text/plain，try/catch 防止 DB 錯誤回 500 導致 ECPay 重試。不需新增 migration。 |
| 待辦 | （無，已完成） |
| 依賴 | T25 ✅ |

---

#### #T27 / M1 金流 / 付款結果頁（成功／失敗）
**說明**：付款完成後的落地頁：成功頁輪詢等 Webhook 更新、失敗頁提供重試。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-26） |
| 產出 | `src/app/checkout/success/page.tsx`（改寫）、`src/app/checkout/success/order-status-check.tsx`（新增）、`src/app/checkout/failed/page.tsx`（新增）、`src/app/api/ecpay/order-result/route.ts`（修改） |
| 更新描述 | 1. `/checkout/success`：Server Component 查 orders+member join。`paid` → 完整成功 UI（訂單號、Email 登入提示）；`pending_payment` → 渲染 `OrderStatusCheck`（Client Component，`router.refresh()` 每 3 秒，90 秒逾時後顯示 amber「將以 email 通知」）；其他 status → redirect `/`。2. `OrderStatusCheck`：`useRef(0)` + `startRef.current = Date.now()` 於 `useEffect` 初始化，避免 `useRef(Date.now())` 在 render 期間呼叫 impure function 導致 `react-hooks/purity` lint error。3. `/checkout/failed`：若 orders.status 已是 `paid` → redirect 成功頁；否則顯示失敗原因＋重試按鈕（回 `/checkout/pay?order=...`）。4. `order-result` route：付款失敗改 redirect `/checkout/failed?order=xxx`（原本是回 `/checkout/pay?error=payment_failed`，移除 pay 頁的 error banner）。 |
| 待辦 | （無，已完成） |
| 驗收 | `pnpm lint` ✅、`pnpm build` ✅；branch `feature/t27-payment-result-pages`，PR merge commit。 |
| 依賴 | T26 ✅ |

---

#### #T53 / M1 金流 / ECPay MerchantTradeNo 冪等性
**說明**：防止同一訂單因重付或 Webhook 重試產生重複 MerchantTradeNo，確保金流冪等。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-26） |
| 產出 | `src/lib/ecpay/merchant-trade-no.ts`（新增）、`src/app/checkout/pay/page.tsx`（改寫）、`src/app/api/ecpay/notify/route.ts`（改寫）、`src/lib/ecpay/aio-payment.ts`（修改） |
| 更新描述 | 1. `generateMerchantTradeNo(orderNo)`：order_no 去 hyphen（17 字元）+ 2 隨機英數字元 = 19 字，在 ECPay 20 字上限內，每次付款嘗試都有唯一 trade no。2. `checkout/pay/page.tsx`：先查 orders.status（`paid` → redirect success）；再查 pending_payment 表，若存在 pending payment row 直接 reuse 其 merchantTradeNo；否則新建 payment row 並產生新 trade no → 傳給 `buildAioParams()`。3. `notify/route.ts`：改以 `merchant_trade_no` 為 lookup key（不再 parse order_no 字串）；UPDATE 加 `.eq("status","pending")` 競態守衛；INSERT fallback 加 23505 graceful handling。DB 已有 `payment.merchant_trade_no UNIQUE` + `uq_payment_one_paid_per_order` partial index，不需新 migration。 |
| 待辦 | （無，已完成） |
| 驗收 | `pnpm lint` ✅、`pnpm build` ✅；branch `feature/t53-idempotency`，PR merge commit。 |
| 依賴 | T26 ✅、T27 ✅ |

---

#### #T41 / M1 安全 / 伺服器端驗價＋金鑰隔離
**說明**：建立訂單時在伺服器端依 DB 白名單重新計算金額，不信任 cart 快照；金額變動時走 R/S/Q 通知 loop 而非靜默建單。

| 項目 | 內容 |
|------|------|
| 狀態 | ✅ 完成（2026-06-26） |
| 產出 | `src/lib/quote/verify-prices.ts`（新增）、`src/lib/env.server.ts`（修改）、`src/lib/supabase/service-role.ts`（修改）、`src/app/checkout/actions.ts`（修改）、`src/components/checkout-form.tsx`（修改） |
| 更新描述 | 1. **`verify-prices.ts`**：`import "server-only"`；Zod 驗 config_snapshot 形狀；DB 重查 `product.base_price`（必須 `status=active`，否則 throw）；查 `product_option` join whitelist（含 `option_value.label`）建立 price map；遍歷 selections 驗白名單，白名單外 throw；重建 `verifiedSelections`（用 DB 當下的 label/priceDelta，不沿用快照）與 `verifiedConfigSnapshot`；回傳 `priceChanged: boolean`（`verifiedUnitPrice !== unit_price_snapshot`）。2. **`env.server.ts`**：加入 `SUPABASE_SERVICE_ROLE_KEY: required()`，啟動時 fail-fast 驗證。3. **`service-role.ts`**：改用 `serverEnv.SUPABASE_SERVICE_ROLE_KEY`（不再 `process.env.XXX!`）。4. **`createOrder`（actions.ts）**：驗價後若 `changedItems.length > 0` → 批次更新 `cart_item.unit_price_snapshot + config_snapshot` → `revalidatePath("/cart")`／`"/checkout"` → 回傳 `{ ok: false, error: "商品金額已更新，請確認新金額後再次送出", priceUpdated: true }`，不建立訂單（**R/S/Q loop，對齊 user-flow.md：不靜默用新價建單**）。5. **`checkout-form.tsx`**：區分 `priceUpdated`（amber 警示 + `router.refresh()`，讓使用者看到新金額後再次送出）vs 硬錯誤（紅色，不 refresh）。**Blind spot 修正記錄**：初版實作「驗價後直接用新金額建單」，但 Ultraplan plan review 指出這違反 user-flow.md R/S/Q 節點設計（頁面顯示舊價、ECPay 收新價，體驗斷裂）。補上 mismatch 通知 loop 後，兩次送出之間使用者可看到更新後金額，ECPay 與頁面數字一致。 |
| 待辦 | （無，已完成） |
| 驗收 | `pnpm lint` ✅、`pnpm build` ✅；branch `feature/t41-server-price-verify`，PR merge commit。 |
| 依賴 | T23 ✅ |

---

### 下次作業

#### #T58 / M1 安全 / 應用層安全防護
**說明**：安全標頭、速率限制、輸入淨化等應用層防護。

| 項目 | 內容 |
|------|------|
| 狀態 | ⬜ 未開始 |
| 待辦 | 評估範圍：Content-Security-Policy、rate limiting（Vercel Edge / upstash）、常見 OWASP 防護 |
| 依賴 | T41 ✅ |

---

#### #T51 / M1 測試 / 報價引擎單元測試
**說明**：為 `verify-prices.ts` 等核心邏輯補上單元測試，需先建置測試框架（vitest）。

| 項目 | 內容 |
|------|------|
| 狀態 | ⬜ 未開始 |
| 待辦 | 安裝 vitest；覆蓋：白名單外選項 throw、base_price 重算、priceChanged 判斷 |
| 依賴 | T41 ✅ |

---

#### #T30a / M1 Email / 下單確認信
**說明**：建立訂單後寄送確認信給客人（需先安裝 Resend）。

| 項目 | 內容 |
|------|------|
| 狀態 | ⬜ 未開始（⚠️ 需先 `pnpm add resend`） |
| 待辦 | 安裝 Resend；設計 Email 範本；`createOrder` 成功後 fire-and-forget 寄信 |
| 依賴 | T23 ✅ |

---

#### #T49 / M1 Email / 新訂單通知店家
**說明**：新訂單成立後通知店家（和 T30a 共用 Resend，建議一起做）。

| 項目 | 內容 |
|------|------|
| 狀態 | ⬜ 未開始（⚠️ 需先 `pnpm add resend`） |
| 依賴 | T30a |

---

## 📋 日誌範本（複製使用）

```
## 📅 YYYY-MM-DD

### 本次作業

#### #任務ID / 模組 / 說明
**說明**：（一句話描述本次目標）

| 項目 | 內容 |
|------|------|
| 狀態 | ⬜ / ⏳ / ✅ / ⚠️ |
| 產出 | （檔案、commit、截圖等） |
| 更新描述 | （做了什麼、改了什麼） |
| 待辦 | （本次未完成的項目） |

---

### 下次作業

#### #任務ID / 模組 / 說明
**說明**：（一句話描述下次目標）

| 項目 | 內容 |
|------|------|
| 狀態 | ⬜ 未開始 |
| 更新描述 | — |
| 待辦 | （具體步驟） |
| 依賴 | （前置任務 ID） |
| 注意 | （風險或限制） |
```
