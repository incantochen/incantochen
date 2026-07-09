-- 0009: 新增 pii_access_log 稽核表（T80，決策 #13）
-- 取代 logPiiAccess 的 stdout log：Vercel function logs 留存過短（數小時到數天），
-- 稽核紀錄需可回溯「誰在何時看過哪位客人的完整個資」。第 15 張破例表。
-- actor_id 直接 FK auth.users(id)（不比照 order_status_log FK member(id)）：
-- 後台 admin 身份純靠 ADMIN_EMAIL 判定，不一定有 member 列；on delete restrict，
-- 稽核紀錄不可因刪除帳號而遺失佐證。

create table public.pii_access_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid not null references auth.users (id) on delete restrict,
  actor_email  text not null,
  order_id     uuid not null references public.orders (id) on delete restrict,
  fields       text[] not null,
  created_at   timestamptz not null default now()
);

comment on table public.pii_access_log is
  'PII 存取稽核（T80，決策 #13）；取代 stdout log，僅 service role insert，禁 update/delete，隨 T34 備份保存';

create index idx_pii_access_log_order on public.pii_access_log (order_id);
create index idx_pii_access_log_actor on public.pii_access_log (actor_id);

alter table public.pii_access_log enable row level security;
-- 無任何 policy：deny-by-default 即達成「僅 service role 可讀寫」（比照 0002 §4 慣例）

revoke update, delete on public.pii_access_log from anon, authenticated;
