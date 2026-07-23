-- 0024: orders.delivery_method（T137）——結帳頁配送方式選擇（面交／宅配）
-- T137：把「面交自取／宅配物流」的選擇從「後台出貨時才由 admin 以 tracking_no
--   『面交』前綴分流」提前到結帳頁，並持久化成正規欄位。前綴慣例（見
--   src/lib/order/shipping-tracking.ts 與 0023 anonymize_member 的 like '面交%'）
--   本任務保留作面交備註儲存與舊資料相容，不移除（留 follow-up）。
-- shipping_fee：面交／宅配皆維持 0 佔位（T48 運費計算暫緩）。
-- 還原（緊急回退，僅 local；正式環境改新增 drop migration）：
--   drop function if exists public.create_order_with_items(
--     uuid, text, uuid, text, text, text, text, text, numeric, numeric, numeric,
--     boolean, timestamptz, jsonb);
--   -- 重建 0010 舊簽章（不含 p_delivery_method）
--   alter table public.orders drop column if exists delivery_method;

alter table public.orders
  add column delivery_method text not null default 'delivery'
    check (delivery_method in ('delivery', 'pickup'));

comment on column public.orders.delivery_method is
  'T137：配送方式。delivery＝宅配（黑貓保價＋本人簽收）／pickup＝面交自取。
   結帳頁選定、下單當下寫入。面交免地址（shipping_address/zip_code 存空字串）。
   與 tracking_no『面交』前綴並存：前綴為出貨時的面交備註儲存與舊資料相容
   （0023 PII 清洗仍靠 like ''面交%''），本欄為配送方式的正規判斷來源。';

-- 舊資料 backfill：出貨時打過「面交」前綴的訂單回填成 pickup。
update public.orders
  set delivery_method = 'pickup'
  where tracking_no like '面交%';

-- 改 RPC create_order_with_items：新增 p_delivery_method 參數。新增中段參數會
-- 產生 overload（create or replace 無法覆蓋不同 arg list 的函式），故先 drop
-- 0010 的舊簽章再 create。.rpc() 用具名參數，SQL 端參數順序不影響 JS 呼叫。
drop function if exists public.create_order_with_items(
  uuid, text, uuid, text, text, text, text, numeric, numeric, numeric,
  boolean, timestamptz, jsonb);

create or replace function public.create_order_with_items(
  p_member_id uuid,
  p_order_no text,
  p_cart_id uuid,
  p_recipient_name text,
  p_recipient_phone text,
  p_zip_code text,
  p_shipping_address text,
  p_delivery_method text,
  p_subtotal numeric,
  p_shipping_fee numeric,
  p_total_amount numeric,
  p_custom_consent boolean,
  p_consent_at timestamptz,
  p_items jsonb
) returns public.orders
language plpgsql
as $$
declare
  v_order public.orders;
begin
  insert into public.orders (
    member_id, order_no, cart_id, recipient_name, recipient_phone,
    zip_code, shipping_address, delivery_method, subtotal, shipping_fee,
    total_amount, custom_consent, consent_at
  )
  values (
    p_member_id, p_order_no, p_cart_id, p_recipient_name, p_recipient_phone,
    p_zip_code, p_shipping_address, p_delivery_method, p_subtotal, p_shipping_fee,
    p_total_amount, p_custom_consent, p_consent_at
  )
  returning * into v_order;

  insert into public.order_item (
    order_id, product_id, product_name_snapshot, quantity,
    unit_price_snapshot, config_snapshot
  )
  select
    v_order.id,
    (item->>'product_id')::uuid,
    item->>'product_name_snapshot',
    (item->>'quantity')::int,
    (item->>'unit_price_snapshot')::numeric,
    item->'config_snapshot'
  from jsonb_array_elements(p_items) as item;

  return v_order;
end;
$$;

comment on function public.create_order_with_items is
  'T76／T137：createOrder 交易化——orders + order_item 單一 function 內完成，
   任何一段 insert 失敗（含 order_item FK 違反）整段自動 rollback，避免孤兒
   訂單。T137 新增 p_delivery_method（配送方式）。';
