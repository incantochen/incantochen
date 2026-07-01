-- =============================================================================
-- incantochen MVP — 0004_add_actor_to_order_status_log
-- 補 order_status_log 的 actor_id（操作者）與 is_override（是否為 Admin bypass）欄位
-- 對應任務：T28（訂單狀態機）+ T29（狀態紀錄）
-- -----------------------------------------------------------------------------
-- actor_id NULL  = 系統自動（ECPay Webhook 等）
-- actor_id 有值  = 後台操作者的 member.id
-- is_override false = 正常狀態機轉換
-- is_override true  = Admin 手動 bypass，強制改狀態（Reason 必填，記錄於 note）
-- =============================================================================

ALTER TABLE public.order_status_log
  ADD COLUMN actor_id    uuid references public.member(id) on delete set null,
  ADD COLUMN is_override bool not null default false;

comment on column public.order_status_log.actor_id    is 'NULL=system; otherwise the member.id of the admin who triggered this transition';
comment on column public.order_status_log.is_override is 'true when an admin bypassed the normal state machine constraints';
