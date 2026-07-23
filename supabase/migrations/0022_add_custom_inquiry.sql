-- 0022: 新增 custom_inquiry 全客製預約／詢問表（T104）
-- user-flow Flow 4（MVP）：/custom 只做「預約／詢問表單」——捕捉需求、通知店家，
-- 人工一對一後續。不接金流、不建訂單；完整報價→確認書→鎖價為 Phase 3。
-- 第 17 張表破例（CLAUDE.md §5「16 表鎖定」）：決策 #15（docs/decisions.csv）。
-- 現有 16 表無一適配——support_request 綁訂單且需登入；此表免登入、Email 即身分。
-- 設計要點：
--   • category／budget_band 用 text+check 非 enum：日後增值只需改 constraint。
--   • 無 member_id：訪客公開表單，Email 即身分（不綁會員）。
--   • status 暫不加 check：人工流程狀態機日後再定；本階段 app 層只寫 'new'。
--   • deny-by-default：不建任何 policy → 前台 anon/authenticated 全拒；
--     寫入／後台讀取一律走 service role（service-role.ts）。

create table public.custom_inquiry (
  id             uuid primary key default gen_random_uuid(),
  category       text not null
    check (category in ('ring', 'earring', 'bracelet', 'necklace', 'unsure')),
  budget_band    text not null
    check (budget_band in ('2-3', '3-5', '5plus', 'chat')),
  idea           text not null
    check (char_length(idea) between 1 and 2000),
  email          text not null
    check (char_length(email) between 3 and 254),
  phone          text
    check (phone is null or char_length(phone) <= 40),
  preferred_time text
    check (preferred_time is null or char_length(preferred_time) <= 100),
  status         text not null default 'new',  -- 人工流程用；狀態機日後再定，暫不加 check
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.custom_inquiry is
  '全客製預約／詢問（T104）；MVP 只捕捉需求＋通知店家，人工一對一後續。免登入，Email 即身分';
comment on column public.custom_inquiry.status is
  '本階段固定 new；人工流程狀態機日後定案後再補 check constraint 與流轉';

create index idx_custom_inquiry_created on public.custom_inquiry (created_at desc);

create trigger trg_custom_inquiry_updated_at
  before update on public.custom_inquiry
  for each row execute function public.set_updated_at();  -- 0001 既有 function

alter table public.custom_inquiry enable row level security;

-- 詢問紀錄＝營運資料，禁硬刪（與無 delete policy 雙保險，0002 慣例）
revoke delete on public.custom_inquiry from anon, authenticated;
