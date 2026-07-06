alter table public.payment
  add column last_reconciled_at timestamptz;

comment on column public.payment.last_reconciled_at is
  'ECPay 主動對帳（T89）上次查詢 QueryTradeInfo 的時間，避免同一筆 24 小時內被重複查詢/告警';
