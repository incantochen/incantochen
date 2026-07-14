-- 0015: T13 款式選項對應 CRUD 支援——product_option 排序完整性＋原子取號/交換
--        ＋product_option_value 預設值原子切換
-- 設計要點：
--   • product_option 比照 option_value（0014）補 unique(product_id, sort_order)
--     ＋insert/move RPC。與 0014 的差異：product_option 的第二個唯一約束是
--     (product_id, option_type_id)——insert 的 unique_violation 先看
--     constraint_name，只有排序約束才重試，同型別重複（真實使用者錯誤）
--     原樣拋 23505 讓呼叫端回「此選項類型已加入過」。
--   • product_option_value 不需要排序欄位（前台值排序沿用全域
--     option_value.sort_order），故本檔不動 pov 的排序；只加一支
--     set_default_product_option_value() 做「同組至多一個 is_default」的
--     原子切換——避免「先清舊預設、再設新預設」兩段 UPDATE 的中間態。
--   • 三支新 RPC 全部 revoke execute（0011/0014 慣例：寫入路徑 RPC 只留
--     service role；anon 經 PostgREST 呼叫即使 RLS 擋寫，move 的 for update
--     仍可拿來鎖目錄列）。
-- 還原（僅 local；正式環境開新 migration）：
--   drop function if exists public.set_default_product_option_value(uuid);
--   drop function if exists public.move_product_option(uuid, text);
--   drop function if exists public.insert_product_option(uuid, uuid, boolean);
--   alter table public.product_option drop constraint uq_product_option_product_sort;

-- =============================================================================
-- 1. product_option 排序完整性（鏡像 0013/0014）
-- =============================================================================

-- 既有資料（seed 從 1 起跳、且未來 race 窗口可能產生重複）先確定性重排成
-- 0 起跳（一次性資料修正，不違反「應用層禁全量 reindex」——那條管每次操作）
with ranked as (
  select id,
         row_number() over (
           partition by product_id
           order by sort_order, created_at, id
         ) - 1 as rn
  from public.product_option
)
update public.product_option po
set sort_order = r.rn
from ranked r
where r.id = po.id and po.sort_order <> r.rn;

alter table public.product_option
  add constraint uq_product_option_product_sort unique (product_id, sort_order);

-- =============================================================================
-- 2. insert_product_option()——原子取號插入
--    unique_violation 先看 constraint_name：排序取號競爭才重試，
--    (product_id, option_type_id) 衝突（同型別已加過）原樣拋 23505。
-- =============================================================================

create or replace function public.insert_product_option(
  p_product_id uuid,
  p_option_type_id uuid,
  p_required boolean
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_constraint text;
begin
  for attempt in 1..3 loop
    begin
      insert into public.product_option
        (product_id, option_type_id, required, sort_order)
      values (
        p_product_id,
        p_option_type_id,
        p_required,
        (select coalesce(max(sort_order), -1) + 1
           from public.product_option
          where product_id = p_product_id)
      )
      returning id into v_id;
      return v_id;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'uq_product_option_product_sort' then
        raise; -- (product_id, option_type_id) 重複等真實錯誤，不吞
      end if;
      -- 排序取號競爭：重讀 max 重試
    end;
  end loop;
  raise exception 'insert_product_option: 排序取號重試 3 次仍衝突';
end;
$$;

comment on function public.insert_product_option(uuid, uuid, boolean) is
  'T13：原子化「排最後」插入款式選項對應；排序搶號由 uq_product_option_product_sort 攔下重試，(product_id,option_type_id) 衝突原樣拋 23505';

-- =============================================================================
-- 3. move_product_option()——原子交換排序（鏡像 move_option_value）
-- =============================================================================

create or replace function public.move_product_option(
  p_product_option_id uuid,
  p_direction text
) returns text  -- 'moved' | 'edge' | 'not_found'
language plpgsql
as $$
declare
  v_target public.product_option%rowtype;
  v_neighbor public.product_option%rowtype;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'move_product_option: 無效方向 %', p_direction;
  end if;

  select * into v_target
    from public.product_option
   where id = p_product_option_id
     for update;
  if not found then
    return 'not_found';
  end if;

  -- 鄰居也上鎖：兩個並發 move 只能依序執行，不會交錯出重複值
  if p_direction = 'down' then
    select * into v_neighbor
      from public.product_option
     where product_id = v_target.product_id
       and sort_order > v_target.sort_order
     order by sort_order asc
     limit 1
       for update;
  else
    select * into v_neighbor
      from public.product_option
     where product_id = v_target.product_id
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
  update public.product_option
     set sort_order = -1 - v_target.sort_order
   where id = v_target.id;
  update public.product_option
     set sort_order = v_target.sort_order
   where id = v_neighbor.id;
  update public.product_option
     set sort_order = v_neighbor.sort_order
   where id = v_target.id;

  return 'moved';
end;
$$;

comment on function public.move_product_option(uuid, text) is
  'T13：原子交換相鄰兩組款式選項的 sort_order；row lock 序列化並發、交易保證無部分成功';

-- =============================================================================
-- 4. set_default_product_option_value()——同組至多一個 is_default 的原子切換
--    「先清舊預設、再設新預設」兩段 UPDATE 在並發下有中間態（短暫零預設或
--    雙預設）。收進單一 UPDATE：把整組的 is_default 一次算成 (id = 目標)，
--    命中目標那列 true、其餘 false。回傳受影響列數（0 = 目標 pov 不存在，
--    多半是剛被別的分頁刪掉，呼叫端回友善訊息）。
-- =============================================================================

create or replace function public.set_default_product_option_value(
  p_pov_id uuid
) returns integer
language plpgsql
as $$
declare
  v_product_option_id uuid;
  v_affected integer;
begin
  select product_option_id into v_product_option_id
    from public.product_option_value
   where id = p_pov_id;
  if not found then
    return 0;
  end if;

  update public.product_option_value
     set is_default = (id = p_pov_id)
   where product_option_id = v_product_option_id;
  get diagnostics v_affected = row_count;
  return v_affected;
end;
$$;

comment on function public.set_default_product_option_value(uuid) is
  'T13：把某 pov 設為所屬 product_option 的唯一預設值；同組其餘一併清為 false，單一交易無中間態';

-- =============================================================================
-- 5. RPC 執行權收斂（0011/0014 慣例：寫入路徑 RPC 只留 service role）
-- =============================================================================

revoke execute on function public.insert_product_option(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.move_product_option(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.set_default_product_option_value(uuid)
  from public, anon, authenticated;
