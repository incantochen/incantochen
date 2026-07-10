-- 0010: orders.cart_id（T75）＋ create_order_with_items() RPC（T76）
-- T75：訂單成立當下（付款前）不再清空購物車——cart_id 記住這張訂單源自哪個
--   cart，付款成功（ensureOrderPaid）才由後端刪除，避免客人付款失敗要重配置。
-- T76：createOrder 原本分兩段 insert（orders、order_item），中間若失敗會留下
--   孤兒訂單。改成單一 Postgres function，插入失敗整段自動 rollback。
-- 本專案第一次引入 .rpc() 呼叫（既有唯一 plpgsql function 是純 trigger 用的
--   set_updated_at()），故獨立成一支 migration。
-- 還原（緊急回退，僅 local；正式環境改新增 drop migration）：
--   drop function if exists public.create_order_with_items(
--     uuid, text, uuid, text, text, text, text, numeric, numeric, numeric,
--     boolean, timestamptz, jsonb);
--   alter table public.orders drop column if exists cart_id;

alter table public.orders
  add column cart_id uuid references public.cart (id) on delete set null;

comment on column public.orders.cart_id is
  'T75：訂單來源購物車，nullable。付款成功才刪除對應 cart（見 ensureOrderPaid），下單當下不清空。';

create or replace function public.create_order_with_items(
  p_member_id uuid,
  p_order_no text,
  p_cart_id uuid,
  p_recipient_name text,
  p_recipient_phone text,
  p_zip_code text,
  p_shipping_address text,
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
    zip_code, shipping_address, subtotal, shipping_fee, total_amount,
    custom_consent, consent_at
  )
  values (
    p_member_id, p_order_no, p_cart_id, p_recipient_name, p_recipient_phone,
    p_zip_code, p_shipping_address, p_subtotal, p_shipping_fee, p_total_amount,
    p_custom_consent, p_consent_at
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
  'T76：createOrder 交易化——orders + order_item 單一 function 內完成，任何一段
   insert 失敗（含 order_item FK 違反）整段自動 rollback，避免孤兒訂單。';
