-- 0016: T42 電子發票——orders 加 invoice_meta 存發票去向與開立結果
-- 設計要點：
--   • 既有 orders.invoice_no / invoice_status（enum none/issued/allowance/voided，
--     0001）沿用，本檔不動。
--   • invoice_meta jsonb：結帳時寫入發票去向（target/carrier_num/customer_identifier），
--     開立成功後補寫 ECPay 回傳的 random_number/invoice_date——一個欄位涵蓋
--     「去向設定」與「開立結果」兩階段，不另開表（維持 15+1 表規範內）。
--   • 不加 unique/index：invoice_meta 只在單筆訂單詳情頁讀取，無需依此欄位查詢。
-- 還原（僅 local；正式環境開新 migration）：
--   alter table public.orders drop column if exists invoice_meta;

alter table public.orders
  add column invoice_meta jsonb;

comment on column public.orders.invoice_meta is
  'T42：發票去向與開立結果。結帳寫入 { target: personal|company|mobile_barcode, '
  'carrier_num?, customer_identifier? }；開立成功後併入 { random_number, invoice_date }。'
  '一筆付款最多一張發票的冪等鍵是 RelateNumber（由 merchant_trade_no 衍生，見 '
  'src/lib/ecpay/invoice/relate-number.ts），不存在本欄位。';
