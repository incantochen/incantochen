# T33 售後申請（分類）— 實作計畫

> Repo：`C:\Users\fishe\Claude\Projects\incantochen\jewelry-shop`
> Branch：`feat/t33-support-request`（feature branch＋PR，使用者 OK 才 merge）

## Context

M2 進行到 T33：會員從訂單詳情頁發起售後申請。IA 已定案入口**僅** `/account/orders/[id]/support`（Flow 3）。現有 13 張表沒有能存申請內容的表（`notification` 只是寄信 log，`unique(order_id,type)` 會擋同訂單多次申請），故需新表＋migration。後台審核分流與綠界退刷是 T47（M5），本次**不做 admin UI**，通知店家靠 email。

**本次拍板的決策（使用者已確認，2026-07-02）：**
1. **新增 `support_request` 表**（migration 0006）——「勿隨意增刪表」規則破例，一次到位供 T47 沿用。
2. **新 business rule：半客製品＝法定客製品，無七天鑑賞退貨**。所有退貨走申請→店家人工確認→手動 trigger 退款（T47）。頁面告知「客製商品不適用七天鑑賞期」（草稿佔位，⚖️ TODO(T36) 待律師審）。
3. 不做佐證照片上傳（照片由店家收到通知後 email 往來索取）。
4. 不做 `/after-sales` 公開說明頁（留 T36）。
5. **加最小後台處理區塊**（2026-07-02 追加拍板）：`/admin/orders/[id]` 顯示售後申請＋改狀態（處理中/已完成/已駁回），讓客人端狀態能同步更新。完整審核分流＋綠界退刷 API 仍留 T47；過渡期退刷操作走**綠界廠商後台手動退刷**＋既有 Admin Override 改訂單 `refunded`。
6. **客戶端只開放單一類型**（2026-07-02 追加拍板）：客人表單**無類型選擇**，字樣統一為「售後申請」（實質＝退貨/瑕疵申訴，存 `return_defect`）；「維修/保養」暫不開放客人自助送出。**後台可手動新增售服案件**（類型可選退貨/瑕疵或維修/保養），供店家登錄 email/電話進來的案件。

## 1. Migration `supabase/migrations/0006_add_support_request.sql`

⚠️ **migration 紅線：寫好 SQL 後先出示給使用者、取得明確同意才 `db push`。部署順序：先 db push、再 merge PR（T65 前例）。**

```sql
-- 0006: 新增 support_request 售後申請表（T33）
-- 業務決策（2026-07-02 拍板）：半客製品＝法定客製品，無七天鑑賞退貨。
-- 類型僅兩類：return_defect（退貨申請：瑕疵/錯誤）、repair_maintenance（維修/保養）。
-- 所有退貨走申請 → 店家人工確認 → 手動 trigger 退款（T47）。
-- 設計要點：
--   • request_type 用 text+check 非 enum：日後增類型（改圈/換尺寸，T47/律師確認後）
--     只需 drop/recreate constraint；Postgres enum 值無法移除。
--   • status 刻意不加 check：RMA 狀態機 T47 才定案。寫入僅 service role
--    （RLS deny 前台寫入），本階段 app 層只寫 'pending'；T47 定案後補 check。
--   • FK 一律 RESTRICT（帳務鏈慣例，0001）；冗餘存 member_id 供 RLS 直接判斷歸屬。

create table public.support_request (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete restrict,
  member_id    uuid not null references public.member (id) on delete restrict,
  request_type text not null
    check (request_type in ('return_defect', 'repair_maintenance')),
  description  text not null
    check (char_length(description) between 1 and 2000),
  status       text not null default 'pending',  -- T47 定案狀態機後補 check
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table  public.support_request is '售後申請（T33）；審核分流與退刷見 T47';
comment on column public.support_request.request_type is
  'return_defect=退貨申請（瑕疵/錯誤）｜repair_maintenance=維修/保養。半客製=法定客製品，無七天鑑賞退貨（T33 拍板）';
comment on column public.support_request.status is
  '本階段固定 pending；RMA 狀態機 T47 定案後補 check constraint 與流轉';

create index idx_support_request_order  on public.support_request (order_id);
create index idx_support_request_member on public.support_request (member_id);

create trigger trg_support_request_updated_at
  before update on public.support_request
  for each row execute function public.set_updated_at();  -- 0001 既有 function

alter table public.support_request enable row level security;

create policy support_request_select_own on public.support_request
  for select to authenticated
  using (member_id = (select auth.uid()));

-- 售後紀錄＝帳務類證據，禁硬刪（與無 delete policy 雙保險，0002 慣例）
revoke delete on public.support_request from anon, authenticated;
```

Push 後：`pnpm supabase gen types typescript` 重生 `src/types/database.types.ts`；本機 `supabase db reset --local` 同步。

## 2. 新增檔案

### `src/lib/support/support-request.ts` — 常數與型別（單一事實來源，仿 `order-status.ts`）
- `SupportRequestType = "return_defect" | "repair_maintenance"`（手寫 union；DB check 兩值都收，`repair_maintenance` 僅後台手動建立）
- `REQUEST_TYPE_LABELS`：`return_defect: "退貨/瑕疵"`、`repair_maintenance: "維修/保養"`（顯示於後台與客人端申請紀錄）
- `SupportRequestStatus = "pending" | "in_progress" | "completed" | "rejected"`（MVP 最小集合；T47 定案完整 RMA 狀態機時再擴充，DB 端無 check 不受限）
- `SUPPORT_STATUS_LABELS`：`pending: "已收到申請"`、`in_progress: "處理中"`、`completed: "已完成"`、`rejected: "已駁回"`＋pill style（沿用前台品牌色系）
- `SUPPORT_ELIGIBLE_STATUSES: OrderStatus[] = ["paid", "in_production", "shipped", "completed"]`（import 自 `src/lib/order/order-status.ts`）＋`canRequestSupport(status): boolean`
- `CUSTOM_NO_RETURN_NOTICE` 告知文字常數，檔內 `// ⚖️ TODO(T36): 草稿佔位，上線前以律師審定版取代`（T57 慣例）。草稿方向：「本店商品均為接單訂製之客製化商品，依法不適用七天鑑賞期。商品如有瑕疵或錯誤，請選擇『退貨申請』並詳述狀況。」

### `src/lib/support/schema.ts` — Zod v4（仿 `src/lib/account/schema.ts`）
```ts
// 客人表單：無類型選擇（一律 return_defect，action 內寫死）
export const supportRequestFormSchema = z.object({
  description: z.string().trim().min(10, "請至少填寫 10 個字，說明狀況").max(2000, "說明長度上限 2000 字"),
})
export type SupportRequestFormValues = z.infer<typeof supportRequestFormSchema>

// 後台手動建立售服案件：類型可選
export const adminSupportCaseSchema = z.object({
  requestType: z.enum(["return_defect", "repair_maintenance"], { message: "請選擇案件類型" }),
  description: supportRequestFormSchema.shape.description,
})
export type AdminSupportCaseValues = z.infer<typeof adminSupportCaseSchema>
```

### `src/app/account/orders/[id]/support/page.tsx` — Server Component
1. `requireUser()`（`src/lib/auth/require-user.ts`）
2. RLS client（`@/lib/supabase/server` 的 `createClient()`）查 orders：`.eq("id", id).eq("member_id", user.id)`，查無 `notFound()`（仿 `src/app/account/orders/[id]/page.tsx`）
3. `canRequestSupport(order.status)` 不合格 → 顯示「此訂單目前無法申請售後」＋回訂單連結，不渲染表單
4. RLS client 查既有 `support_request`（SELECT own policy 直查）→ 顯示既有申請列表（類型＋狀態 pill＋日期）
5. 渲染：標題（訂單號）＋琥珀色告知區塊（`CUSTOM_NO_RETURN_NOTICE`，T57 同款樣式）＋`<SupportRequestForm orderId hasExisting>`；已有紀錄時表單上方提示「此訂單已有申請紀錄，若為補充說明可再次送出」

### `src/app/account/orders/[id]/support/actions.ts` — Server Action
`createSupportRequest(orderId, values)`，回傳 `{ ok: true } | { ok: false; error: string }`（profile actions 慣例）：
1. `requireUser()` → `z.uuid()` 驗 orderId＋`supportRequestFormSchema.safeParse(values)`
2. **service role**（`createServiceRoleClient()`）重查 orders 驗 `member_id === user.id`＋`canRequestSupport(status)`——不信任 UI
3. insert `support_request`（`request_type` 寫死 `'return_defect'`，status 用 DB default `'pending'`）
4. `try { await sendSupportRequestNotification(requestId) } catch {}` —— **刻意 await＋吞錯**（非 webhook 的 `void...catch` 模式：email 是本次通知店家唯一出口，serverless 回應後可能凍結導致信未送；失敗不擋申請，DB 已有紀錄可人工補救）
5. `revalidatePath` 訂單詳情頁＋support 頁 → `{ ok: true }`

### `src/components/support-request-form.tsx` — Client Component（仿 `profile-form.tsx`）
- **無類型選擇**——頁面與送出鈕字樣統一「售後申請」
- 說明 textarea，`onBlur={validate}`；`useTransition`＋`error/submitError/success` state；送出鈕 `disabled={isPending}`
- **成功後同頁換成功卡片**（不 redirect）：「已收到您的售後申請，我們將盡快以 Email 與您聯繫；如需提供照片，屆時請直接回覆該信件。」＋返回訂單連結＋`router.refresh()`（既有申請列表即時出現）

### `src/lib/email/support-request-notification.ts` — 店家通知（鏡射 `new-order-notification.ts`）
- `import "server-only"`；同 `FROM_EMAIL`/`OWNER_EMAIL` 常數（同款 `TODO(T35)` 註記）
- service role 查 `support_request` join `orders(order_no, recipient_name)`＋`member(email)`
- 主旨：`[售後申請] {order_no} — {類型中文}`；HTML（品牌色 #0f3325/#c9a84c）：訂單號、類型、說明全文、客人姓名/email、footer「請以 email 回覆客人並索取佐證照片」
- **`replyTo: customerEmail`**——店家收信直接回覆即達客人（配合照片走 email 往來）

### `src/app/admin/orders/[id]/support-requests.tsx` — 後台售後處理區塊（Client Component，最小版）
- 顯示該訂單全部 `support_request`：類型、說明全文、狀態、建立時間
- 每筆提供狀態按鈕：`處理中`／`已完成`／`已駁回`（呼叫 server action，`useTransition`）；MVP 不做狀態機約束（T47 再定），終態（completed/rejected）後按鈕仍可改（人工修正用）
- **手動新增售服案件**（折疊區）：類型 select（退貨/瑕疵｜維修/保養）＋說明 textarea＋建立按鈕 → `createSupportCaseByAdmin` action。供店家登錄 email/電話進來的案件（維修/保養只能由此建立）
- 申請說明為客人自填文字，非 T64 遮罩欄位，直接顯示

### 測試（vitest，現有 50 測項不得紅）
- `src/lib/support/schema.test.ts`：客人 schema——description trim 後空/<10 字/>2000 字擋下、10/2000 邊界通過；admin schema——合法兩類型通過、非法/缺 requestType 擋下
- `src/lib/support/support-request.test.ts`：`canRequestSupport` 對 7 個 OrderStatus 全枚舉斷言（4 true/3 false）；LABELS 完整性（REQUEST_TYPE_LABELS／SUPPORT_STATUS_LABELS 每個 union key 都有 label）

## 3. 修改檔案

### `src/app/account/orders/[id]/page.tsx`
- 併查 `support_request`（RLS client）
- 品項卡合計下方（wireframe 位置）：資格內顯示 outline `<Link>`「申請售後」→ `/account/orders/${id}/support`；不資格不渲染
- 已有申請時按鈕上方加摘要小卡（最近一筆：類型＋狀態 pill＋日期）

### `src/app/admin/orders/[id]/page.tsx`
- service role 併查 `support_request`；左欄狀態紀錄時間軸之後加「售後申請」section，渲染 `<SupportRequests>`（無申請時不顯示或顯示空狀態一行）

### `src/app/admin/orders/[id]/actions.ts`
- 加 `updateSupportRequestStatus(requestId, status)` server action：`requireAdmin()` → 驗 status ∈ `SupportRequestStatus` → service role `.update({ status })` → `revalidatePath`（admin 詳情＋客人端 support 頁）→ `{ ok: true }`
- 加 `createSupportCaseByAdmin(orderId, values)` server action：`requireAdmin()` → `adminSupportCaseSchema.safeParse` → service role 查該 order 取 `member_id` → insert `support_request`（type 依選擇、status `'pending'`）→ `revalidatePath` → `{ ok: true }`。**不寄店家通知信**（店家自己建的案件）

### 文件
- `docs/user-flow.md` §3：mermaid 改為——客人單一「售後申請」入口（退貨/瑕疵）＋店家後台手動登錄維修/保養案件；§3.1 **A1 標記已拍板**（半客製＝法定客製品、無七天退）、**B4/B5 部分拍板**（客人自助僅退貨/瑕疵一種入口）、**G19 標記已拍板**（不硬擋、顯示既有紀錄、人工處理）
- `docs/data-model.md`：13→**14 張表**＋新增 support_request 章節（欄位/FK/索引/RLS 定案）
- `CLAUDE.md`：§5「13 張表」同步為 14、頂部加 T33 完成註記
- `docs/tasks.csv`：merge 時 T33 狀態→完成（既有慣例）
- `docs/work-log.md`：session 結束時記錄（既有慣例）

## 4. 設計決策備忘（已定案，實作時勿重開）

| 議題 | 定案 |
|---|---|
| 可申請狀態 | `paid`/`in_production`/`shipped`/`completed`；`pending_payment`（交易未成立）、`cancelled`/`refunded`（終態）不可 |
| 重複申請（G19） | 不硬擋——T47 狀態機未定案，硬擋等於預做決策；且無照片上傳時再送一筆是客人唯一補充管道。頁面顯示既有紀錄＋提示；防連點靠 `disabled={isPending}` |
| status 無 check | T47 定案 RMA 狀態機後以新 migration 補 `check ... not valid`＋`validate constraint`；MVP app 層用 4 值（pending/in_progress/completed/rejected），後台改狀態無狀態機約束 |
| 過渡期退刷 | 綠界廠商後台手動退刷＋既有 Admin Override 改訂單 `refunded`（T31 已有，寫稽核 log）；退刷 API 自動化留 T47 |
| 類型開放範圍 | 客人只能送「售後申請」（存 `return_defect`，UI 無類型選擇）；`repair_maintenance` 僅後台手動建立。DB check 兩值都收，日後開放客人自助只改 UI/schema 不動 DB |
| member_id 冗餘 | RLS 直接 `member_id = (select auth.uid())`，免 join orders；值來自 service role 寫入時的 `requireUser()`，可信 |

## 5. 實作步驟順序

1. 開 branch `feat/t33-support-request`
2. 寫 migration 0006 → **停下，出示 SQL 取得使用者明確同意**（migration 紅線）
3. `supabase db push --linked`＋本機 `supabase db reset --local`
4. `pnpm supabase gen types typescript`，確認 `support_request` 型別出現
5. `src/lib/support/`（常數＋schema＋測試）→ `pnpm test`
6. `src/lib/email/support-request-notification.ts`
7. `actions.ts` → `support/page.tsx` → `support-request-form.tsx`
8. 訂單詳情頁入口按鈕＋摘要
9. 後台：`admin/orders/[id]` 售後區塊＋`updateSupportRequestStatus`＋`createSupportCaseByAdmin` actions
10. 文件更新
11. 驗收：`pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build`

## 6. 驗證（E2E，Playwright＋`admin.generateLink` 免寄信，T06 前例）

- **正向**：登入→進 `paid` 測試訂單詳情→見「申請售後」按鈕→support 頁見告知區塊（無類型選擇）→填說明→送出→同頁成功卡片→返回訂單詳情見申請摘要；service role 直查 DB 確認 row（`request_type='return_defect'`、`status='pending'`）；確認店家信寄達 `fishead02290@gmail.com`（Resend，`onboarding@resend.dev` 只能寄到此帳號信箱，剛好是店家）
- **後台**：以 admin 帳號登入→`/admin/orders/[id]` 見售後申請區塊（類型/說明/狀態）→點「處理中」→客人端 support 頁與訂單詳情摘要的狀態 pill 同步變「處理中」；DB 確認 `status='in_progress'`、`updated_at` 有更新（trigger 生效）→手動新增「維修/保養」案件→客人端申請紀錄出現該筆（類型顯示維修/保養）
- **負向**：`pending_payment` 訂單無按鈕、直打 support URL 顯示不可申請；他人訂單 id 直訪→404（RLS＋顯式檢查）；說明 <10 字 onBlur 出錯誤訊息
- 測試帳號與測試資料清除
