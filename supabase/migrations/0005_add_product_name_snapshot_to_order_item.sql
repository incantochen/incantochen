-- =============================================================================
-- 0005: order_item 補 product_name_snapshot（T65）
-- 下單當下鎖住商品名稱，後台改名／下架不影響已成立訂單的明細顯示。
-- 刻意 nullable：避免「migration 已套用、舊版 createOrder 還在線上」窗口期
-- 因 NOT NULL violation 中斷結帳；窗口期 null 由顯示端 fallback 吸收。
-- =============================================================================

alter table public.order_item
  add column product_name_snapshot text;

comment on column public.order_item.product_name_snapshot is
  '下單當下的商品名稱快照（T65）；後台改名不影響已成立訂單';

-- 回填既有訂單（product FK 為 RESTRICT，被引用的商品不可能被刪，回填必定齊全）
update public.order_item oi
set product_name_snapshot = p.name
from public.product p
where p.id = oi.product_id
  and oi.product_name_snapshot is null;
