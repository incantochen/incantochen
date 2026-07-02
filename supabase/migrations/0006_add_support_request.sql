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
