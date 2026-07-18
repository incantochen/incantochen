-- 0019: support_request.status 補 check constraint（T47 定案 RMA 狀態機）
-- 0006 建表時刻意不加 check（狀態機留 T47 定案，見 data-model.md §8.4）。
-- T47 定案（2026-07-18）：沿用 admin 端既有四值 pending／in_progress／
-- completed／rejected，不另擴 RMA 專屬狀態——退款本身走 orders/payment
-- 狀態機（refund-order.ts），support_request 只追蹤售後案件處理進度。
--
-- 兩段式（0006 註記指定的寫法）：not valid 先擋新寫入（不掃全表、不長鎖），
-- validate constraint 再驗歷史列（僅 SHARE UPDATE EXCLUSIVE，不擋讀寫）。
-- 現況風險：app 層自 T33 起僅寫入這四值（SUPPORT_STATUSES 白名單），
-- validate 預期直接通過；若失敗代表有人繞過 app 直寫，先修資料再重跑。
--
-- 還原（緊急回退，僅 local；正式環境改新增 drop migration）：
--   alter table public.support_request
--     drop constraint support_request_status_check;

alter table public.support_request
  add constraint support_request_status_check
  check (status in ('pending', 'in_progress', 'completed', 'rejected'))
  not valid;

alter table public.support_request
  validate constraint support_request_status_check;

comment on column public.support_request.status is
  'RMA 狀態機（T47 定案）：pending=已收到申請｜in_progress=處理中｜'
  'completed=已完成｜rejected=已駁回。check constraint 於 0019 落地；'
  '日後增值先 drop/recreate constraint（text+check 慣例，同 request_type）';
