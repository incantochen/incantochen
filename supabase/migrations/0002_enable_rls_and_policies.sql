-- =============================================================================
-- incantochen MVP — 0002_enable_rls_and_policies（T46）
-- 依 docs/data-model.md §6：deny-by-default，前台只給 SELECT，寫入全走後端。
-- 前置：0001_initial_schema.sql 已套用。
-- migration 工具：Supabase CLI（docs/migration-guide.md）
-- -----------------------------------------------------------------------------
-- 設計原則：
--   • 13 張表一律 ENABLE RLS；未中任何 policy 的存取＝拒絕。
--   • service_role（後端）有 BYPASSRLS，照常讀寫——所有 INSERT/UPDATE、
--     購物車存取、後台 admin 操作，全部走後端 service role，不靠前端角色。
--   • 因此本支「不建」任何 admin policy（admin = 走後端，MVP 決策）；
--     也「不建」前台的 INSERT/UPDATE/DELETE policy（寫入＝後端）。
--   • 角色：anon（未登入）、authenticated（已登入）、service_role（後端）。
-- -----------------------------------------------------------------------------
-- 還原（僅 local；正式環境改新增 migration）：
--   每張表 disable RLS 並 drop 對應 policy；re-grant delete。詳見檔尾還原區塊。
-- =============================================================================


-- =============================================================================
-- 1. 全表啟用 RLS（deny-by-default）
-- =============================================================================
alter table public.product               enable row level security;
alter table public.option_type           enable row level security;
alter table public.option_value          enable row level security;
alter table public.product_option        enable row level security;
alter table public.product_option_value  enable row level security;
alter table public.member                enable row level security;
alter table public.cart                  enable row level security;
alter table public.cart_item             enable row level security;
alter table public.orders                enable row level security;
alter table public.order_item            enable row level security;
alter table public.payment               enable row level security;
alter table public.order_status_log      enable row level security;
alter table public.notification          enable row level security;


-- =============================================================================
-- 2. 公開唯讀組（anon + authenticated 可 SELECT）
--    product 特別收 status='active'：draft/archived 不外露；後台看全狀態走後端。
-- =============================================================================
create policy product_select_public on public.product
  for select to anon, authenticated
  using (status = 'active');

create policy option_type_select_public on public.option_type
  for select to anon, authenticated
  using (true);

create policy option_value_select_public on public.option_value
  for select to anon, authenticated
  using (true);

create policy product_option_select_public on public.product_option
  for select to anon, authenticated
  using (true);

create policy product_option_value_select_public on public.product_option_value
  for select to anon, authenticated
  using (true);


-- =============================================================================
-- 3. 本人組（authenticated 只能 SELECT 自己的資料；寫入走後端）
--    member.id = auth.users.id（共用 PK）；子表透過 orders 判斷歸屬。
--    auth.uid() 包一層 (select ...) 以利每段查詢快取、提升效能。
-- =============================================================================
create policy member_select_own on public.member
  for select to authenticated
  using (id = (select auth.uid()));

create policy orders_select_own on public.orders
  for select to authenticated
  using (member_id = (select auth.uid()));

create policy order_item_select_own on public.order_item
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_item.order_id
      and o.member_id = (select auth.uid())
  ));

create policy payment_select_own on public.payment
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = payment.order_id
      and o.member_id = (select auth.uid())
  ));

create policy order_status_log_select_own on public.order_status_log
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_status_log.order_id
      and o.member_id = (select auth.uid())
  ));

create policy notification_select_own on public.notification
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = notification.order_id
      and o.member_id = (select auth.uid())
  ));


-- =============================================================================
-- 4. 購物車（cart / cart_item）：後端專屬
--    訪客以 guest_token（httpOnly cookie）識別，前端無可信身分可供 RLS 判斷；
--    加上加車須伺服器端寫快照／驗價，故 cart 一律走後端 service role。
--    → RLS 已啟用、刻意不建任何前台 policy（anon/authenticated 一律拒絕）。
-- =============================================================================
-- （無 policy；deny-by-default 即達成後端專屬）


-- =============================================================================
-- 5. 帳務禁硬刪（權限層紅線，與「無 delete policy」雙保險）
--    orders / payment / order_item / order_status_log 一律軟刪除＝狀態流轉，
--    實體列永久保留。service_role 不受影響（保留緊急/維運能力）。
-- =============================================================================
revoke delete on public.orders           from anon, authenticated;
revoke delete on public.payment          from anon, authenticated;
revoke delete on public.order_item       from anon, authenticated;
revoke delete on public.order_status_log from anon, authenticated;


-- =============================================================================
-- 0002 結束。套用後：supabase gen types typescript → pnpm lint → commit。
-- 備註：前台所有寫入與後台 admin 操作一律走後端 service role；admin 框架見 T09。
-- -----------------------------------------------------------------------------
-- 還原（僅 local）：
--   drop policy if exists product_select_public on public.product;
--   drop policy if exists option_type_select_public on public.option_type;
--   drop policy if exists option_value_select_public on public.option_value;
--   drop policy if exists product_option_select_public on public.product_option;
--   drop policy if exists product_option_value_select_public on public.product_option_value;
--   drop policy if exists member_select_own on public.member;
--   drop policy if exists orders_select_own on public.orders;
--   drop policy if exists order_item_select_own on public.order_item;
--   drop policy if exists payment_select_own on public.payment;
--   drop policy if exists order_status_log_select_own on public.order_status_log;
--   drop policy if exists notification_select_own on public.notification;
--   grant delete on public.orders, public.payment, public.order_item,
--     public.order_status_log to authenticated;
--   alter table public.product ... disable row level security;  -- （13 張表）
-- =============================================================================
