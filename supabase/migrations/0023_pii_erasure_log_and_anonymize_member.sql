-- 0023: pii_erasure_log 表 ＋ member.anonymized_at ＋ anonymize_member() RPC（T63
--       當事人個資權利——刪除＝匿名化）
--
-- 動機：《個資法》賦予當事人刪除自己個資的權利。但 orders.member_id → member 為
--   FK RESTRICT（0001）、member.id → auth.users on delete cascade——有訂單的會員
--   無法實體刪除。故「刪除請求」的技術答案＝匿名化：洗去可識別個資（姓名／email／
--   收件資訊），保留帳務鏈（金額／order_no／發票／金流交易號）以符稅務與對帳保存
--   義務（CLAUDE.md §8「帳務表禁 DELETE」紅線）。
--
-- 原子性：整支 RPC 為單一交易，任一步（含稽核 insert）失敗則整段 rollback——不留
--   「member 已洗、orders 沒洗」的半套狀態。比照 0017/0020/0021 房規。
--
-- 冪等：member.anonymized_at 非 null 即已匿名。Guard 以 SELECT ... FOR UPDATE 序列化
--   並發雙擊：第二個呼叫等第一筆 commit 後重讀，見 anonymized_at 已設 → raise U0011。
--
-- 破例第 17 張表（pii_erasure_log）的理由：匿名化＝改寫（erasure）事件，語意上不可
--   塞進 read-only 的 pii_access_log（0009 明載其職責為稽核「誰在何時*看過*哪位客人
--   的完整個資」＝讀取/揭露）。故另立 change log，讀寫語意分離；比照 pii_access_log
--   當初的破例（決策 #13）。anchor＝target_member_id 而非 order_id，零訂單會員亦有列。
--
-- 呼叫端據自訂 SQLSTATE 分流（不靠脆弱的 message 比對）：
--   U0010＝查無會員（p_member_id 不存在）
--   U0011＝已匿名（anonymized_at 非 null，重入應辨識為「已處理過」）
--
-- 觸發入口＝僅 runbook（管理員驗身分後於 Supabase 以 service role 呼叫）；無前台／
--   後台 UI。auth.users 的真實 email 本 RPC 碰不到（只動 public schema，不用 SECURITY
--   DEFINER），由 runbook 手動 ban＋覆寫 email 處置。
--
-- 還原（緊急回退，僅 local；正式環境改新增 drop migration）：
--   drop function if exists public.anonymize_member(uuid, uuid, text);
--   alter table public.member drop column if exists anonymized_at;
--   drop table if exists public.pii_erasure_log;

-- =============================================================================
-- 1. pii_erasure_log —— PII 匿名化/改寫稽核（比照 0009 pii_access_log 房規）
-- =============================================================================
create table public.pii_erasure_log (
  id                uuid primary key default gen_random_uuid(),
  target_member_id  uuid not null references public.member (id) on delete restrict,
  actor_id          uuid not null references auth.users (id) on delete restrict,
  actor_email       text not null,
  fields            text[] not null,
  created_at        timestamptz not null default now()
);

comment on table public.pii_erasure_log is
  'T63 PII 匿名化/改寫稽核（第 17 張破例表）；記錄「誰在何時匿名化了哪位客人的個資」，與 pii_access_log（讀取/揭露）語意分離；僅 service role insert，禁 update/delete，隨 T34 備份保存';

-- target_member_id on delete restrict＝稽核不因刪帳號而遺失（runbook 對 auth.users 是
-- ban 非刪，member 列續存，RESTRICT 不擋正常流程）；actor_id → auth.users（比照 0009：
-- admin 靠 ADMIN_EMAIL 判定、不一定有 member 列）。
create index idx_pii_erasure_log_member on public.pii_erasure_log (target_member_id);
create index idx_pii_erasure_log_actor  on public.pii_erasure_log (actor_id);

alter table public.pii_erasure_log enable row level security;
-- 無任何 policy：deny-by-default 即達成「僅 service role 可讀寫」（比照 0002/0009 慣例）
revoke update, delete on public.pii_erasure_log from anon, authenticated;

-- =============================================================================
-- 2. member.anonymized_at —— 匿名化時戳（audit＋冪等 guard＋UI 可辨識）
-- =============================================================================
alter table public.member add column anonymized_at timestamptz;

comment on column public.member.anonymized_at is
  'T63 個資匿名化時戳；非 null 即已匿名（冪等 guard＋UI 可辨識）';

-- =============================================================================
-- 3. anonymize_member() —— 原子匿名化 RPC
-- =============================================================================
create or replace function public.anonymize_member(
  p_member_id uuid,
  p_actor_id uuid,
  p_actor_email text
) returns setof public.member
language plpgsql
set search_path = ''
as $$
declare
  v_member public.member;
begin
  -- Guard：FOR UPDATE 序列化並發雙擊（第二個呼叫等第一筆 commit 後重讀）
  select * into v_member
    from public.member
   where id = p_member_id
     for update;

  if not found then
    raise exception 'anonymize_member: 查無會員 %', p_member_id
      using errcode = 'U0010';
  end if;

  if v_member.anonymized_at is not null then
    raise exception 'anonymize_member: 會員 % 已匿名（%）', p_member_id, v_member.anonymized_at
      using errcode = 'U0011';
  end if;

  -- 1) member：email 洗成去識別但保 unique 約束的佔位值、name 清空、蓋時戳
  update public.member
     set email = 'anonymized-' || p_member_id::text || '@deleted.invalid',
         name = null,
         anonymized_at = now()
   where id = p_member_id;

  -- 2) orders（該 member 全部）：收件個資洗掉；tracking_no 面交備註洗、宅配單號留；
  --    invoice_meta 移除個人載具／統編（保留發票稅務結果 target/random_number/invoice_date）。
  --    ⚠️ '面交' 前綴須與 src/lib/order/shipping-tracking.ts 的 PICKUP_PREFIX 一致
  --    （SQL 無法 import TS 常數；前綴改字時兩處同步。此處為只讀分類，非格式 round-trip，
  --     屬 §6 單一出處慣例的已知邊界）。
  update public.orders
     set recipient_name = '已匿名',
         recipient_phone = '已匿名',
         shipping_address = '已匿名',
         zip_code = null,
         tracking_no = case
           when tracking_no like '面交%' then '面交'
           else tracking_no
         end,
         invoice_meta = invoice_meta - 'carrier_num' - 'customer_identifier'
   where member_id = p_member_id;

  -- 3) payment：raw_callback 內嵌綠界回拋的收件姓名／電話／地址，整欄清空
  --    （對帳靠 merchant_trade_no／gateway_trade_no，不依賴 raw_callback）。
  update public.payment
     set raw_callback = null
   where order_id in (
     select id from public.orders where member_id = p_member_id
   );

  -- 4) support_request：客人自由輸入的申訴內容可能含個資
  update public.support_request
     set description = '已匿名'
   where member_id = p_member_id;

  -- 5) 稽核（同交易）：insert 一列 pii_erasure_log（member 級事件，anchor＝
  --    target_member_id 不依賴 orders，零訂單會員亦有列）。actor_id 須為有效
  --    auth.users id，否則 FK 違反使整筆 rollback。
  insert into public.pii_erasure_log (target_member_id, actor_id, actor_email, fields)
  values (
    p_member_id, p_actor_id, p_actor_email,
    array[
      'member.email', 'member.name',
      'orders.recipient_name', 'orders.recipient_phone',
      'orders.shipping_address', 'orders.zip_code',
      'orders.tracking_no(面交)', 'orders.invoice_meta(carrier/統編)',
      'payment.raw_callback', 'support_request.description'
    ]
  );

  return query select * from public.member where id = p_member_id;
end;
$$;

comment on function public.anonymize_member(uuid, uuid, text) is
  'T63 原子匿名化：洗 member.email/name＋orders 收件個資（面交 tracking_no 備註、invoice_meta 個人載具/統編）＋payment.raw_callback＋support_request.description，並於同交易寫 pii_erasure_log 稽核——全程單一交易，任一步失敗整段 rollback。帳務鏈（金額/order_no/發票號/金流交易號）保留以符稅務。冪等靠 member.anonymized_at（重入 raise U0011）；查無會員 raise U0010。觸發僅 runbook（service role），直接呼叫等同 override 級操作；auth.users 真實 email 本 RPC 碰不到，走 runbook 手動 ban＋覆寫。';

revoke execute on function public.anonymize_member(uuid, uuid, text)
  from public, anon, authenticated;
