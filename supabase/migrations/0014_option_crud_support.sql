-- 0014: T12 選項 CRUD 支援——is_active 旗標＋RLS 過濾＋option_value 排序完整性
-- 設計要點：
--   • option_type / option_value 各加 is_active（打錯的項目可下架不外露，
--     不硬刪；使用中項目因 RESTRICT 本來就刪不掉，隱藏是唯一下架手段）。
--   • 公開讀 policy 由 using(true) 改 using(is_active = true)：PDP／addToCart
--     的 anon 查詢自動濾掉隱藏項目（前台查詢須配合改 !inner embed，否則
--     被 RLS 擋下的多對一 embed 會變 null 而非整列消失）；admin 走 service
--     role 不受影響。verify-prices 走 service role，改在應用層過濾。
--   • option_value 排序比照 0013 標準：unique(option_type_id, sort_order)
--     ＋原子取號/交換 RPC。與 0013 的差異：option_value 另有業務唯一約束
--     (option_type_id, code)，insert RPC 的 unique_violation 必須分辨撞到
--     哪個約束——只有排序約束才重試，code 衝突原樣拋給呼叫端回友善訊息。
-- 還原（僅 local；正式環境開新 migration）：
--   drop function if exists public.move_option_value(uuid, text);
--   drop function if exists public.insert_option_value(uuid, text, text, text);
--   alter table public.option_value drop constraint uq_option_value_type_sort;
--   alter policy option_type_select_public on public.option_type using (true);
--   alter policy option_value_select_public on public.option_value using (true);
--   alter table public.option_type drop column is_active;
--   alter table public.option_value drop column is_active;

-- =============================================================================
-- 1. is_active 旗標
-- =============================================================================

alter table public.option_type
  add column is_active boolean not null default true;
alter table public.option_value
  add column is_active boolean not null default true;

comment on column public.option_type.is_active is
  'T12：是否顯示於前台；false＝隱藏（RLS 濾掉），使用中項目不可刪只能隱藏';
comment on column public.option_value.is_active is
  'T12：是否顯示於前台；false＝隱藏（RLS 濾掉），驗價白名單同步排除';

-- =============================================================================
-- 2. 公開讀 policy 收斂到 is_active（比照 product 的 status='active' 模式）
-- =============================================================================

alter policy option_type_select_public on public.option_type
  using (is_active = true);
alter policy option_value_select_public on public.option_value
  using (is_active = true);

-- =============================================================================
-- 3. option_value 排序完整性（鏡像 0013）
-- =============================================================================

-- 既有資料（seed 手填 sort_order）若有重複值，先確定性重排（一次性資料修正）
with ranked as (
  select id,
         row_number() over (
           partition by option_type_id
           order by sort_order, created_at, id
         ) - 1 as rn
  from public.option_value
)
update public.option_value v
set sort_order = r.rn
from ranked r
where r.id = v.id and v.sort_order <> r.rn;

alter table public.option_value
  add constraint uq_option_value_type_sort unique (option_type_id, sort_order);

-- =============================================================================
-- 4. insert_option_value()——原子取號插入
--    與 insert_product_image 的差異：option_value 有兩個唯一約束，
--    unique_violation 先看 constraint_name——排序取號競爭才重試，
--    (option_type_id, code) 衝突是真實使用者錯誤，原樣拋出（23505）
--    讓呼叫端回「code 已被使用」。
-- =============================================================================

create or replace function public.insert_option_value(
  p_option_type_id uuid,
  p_code text,
  p_label text,
  p_swatch_hex text default null
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_constraint text;
begin
  for attempt in 1..3 loop
    begin
      insert into public.option_value
        (option_type_id, code, label, swatch_hex, sort_order)
      values (
        p_option_type_id,
        p_code,
        p_label,
        p_swatch_hex,
        (select coalesce(max(sort_order), -1) + 1
           from public.option_value
          where option_type_id = p_option_type_id)
      )
      returning id into v_id;
      return v_id;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'uq_option_value_type_sort' then
        raise; -- code 衝突等真實錯誤，不吞
      end if;
      -- 排序取號競爭：重讀 max 重試
    end;
  end loop;
  raise exception 'insert_option_value: 排序取號重試 3 次仍衝突';
end;
$$;

comment on function public.insert_option_value(uuid, text, text, text) is
  'T12：原子化「排最後」插入選項值；排序搶號由 uq_option_value_type_sort 攔下重試，code 衝突原樣拋 23505';

-- =============================================================================
-- 5. move_option_value()——原子交換排序（鏡像 move_product_image）
-- =============================================================================

create or replace function public.move_option_value(
  p_option_value_id uuid,
  p_direction text
) returns text  -- 'moved' | 'edge' | 'not_found'
language plpgsql
as $$
declare
  v_target public.option_value%rowtype;
  v_neighbor public.option_value%rowtype;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'move_option_value: 無效方向 %', p_direction;
  end if;

  select * into v_target
    from public.option_value
   where id = p_option_value_id
     for update;
  if not found then
    return 'not_found';
  end if;

  -- 鄰居也上鎖：兩個並發 move 只能依序執行，不會交錯出重複值
  if p_direction = 'down' then
    select * into v_neighbor
      from public.option_value
     where option_type_id = v_target.option_type_id
       and sort_order > v_target.sort_order
     order by sort_order asc
     limit 1
       for update;
  else
    select * into v_neighbor
      from public.option_value
     where option_type_id = v_target.option_type_id
       and sort_order < v_target.sort_order
     order by sort_order desc
     limit 1
       for update;
  end if;
  if not found then
    return 'edge'; -- 已在最前／最後
  end if;

  -- 三步交換：target 先停到負值（sort_order 恆 >= 0，負值必不撞 unique），
  -- 全程單一交易，任何一步失敗整段 rollback
  update public.option_value
     set sort_order = -1 - v_target.sort_order
   where id = v_target.id;
  update public.option_value
     set sort_order = v_target.sort_order
   where id = v_neighbor.id;
  update public.option_value
     set sort_order = v_neighbor.sort_order
   where id = v_target.id;

  return 'moved';
end;
$$;

comment on function public.move_option_value(uuid, text) is
  'T12：原子交換相鄰兩個選項值的 sort_order；row lock 序列化並發、交易保證無部分成功';
