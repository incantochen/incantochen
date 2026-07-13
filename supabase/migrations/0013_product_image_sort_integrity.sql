-- 0013: T11 code-review 修正——product_image 排序完整性（PR #60 findings）
-- 問題：0012 的排序由應用層「SELECT max+1 再 INSERT」與「兩段 UPDATE 交換」維護，
--   並發（多分頁／多管理員）或部分失敗都會落地重複 sort_order；重複值一旦出現，
--   嚴格 gt/lt 的鄰居查詢永遠跳過同值列，UI 無法自癒，主圖（最小值）也隨之不定。
-- 修法（本檔三件事，對齊 CLAUDE.md §6「並發去重靠 DB、check-then-act 必有 race」）：
--   ① unique(product_id, sort_order)——DB 兜底，重複值從此進不來
--   ② insert_product_image()：max+1 與 INSERT 同一函式內執行，unique_violation 重試
--   ③ move_product_image()：鄰居選取＋交換收進單一交易、row lock 消滅交錯；
--      交換用「先停負值」三步走，不觸發 unique 立即檢查（sort_order 恆 >= 0）
-- 附註：product_image FK 為 on delete cascade，但 Storage 檔案不會隨之刪除——
--   日後 T10 若提供商品刪除，必須先呼叫 deleteAllProductImageFiles()
--   （src/lib/storage/product-images.ts）清 bucket，再刪 product 列。
-- 還原（僅 local；正式環境開新 migration）：
--   drop function if exists public.move_product_image(uuid, text);
--   drop function if exists public.insert_product_image(uuid, text);
--   alter table public.product_image drop constraint uq_product_image_product_sort;
--   create index idx_product_image_product_sort
--     on public.product_image (product_id, sort_order);

-- =============================================================================
-- 1. 既有資料去重＋唯一約束
-- =============================================================================

-- 0012 上線至今的 race 窗口若已產生重複值，先確定性重排（一次性資料修正，
-- 不違反「應用層禁全量 reindex」——那條規則管的是每次操作的行為）
with ranked as (
  select id,
         row_number() over (
           partition by product_id
           order by sort_order, created_at, id
         ) - 1 as rn
  from public.product_image
)
update public.product_image p
set sort_order = r.rn
from ranked r
where r.id = p.id and p.sort_order <> r.rn;

alter table public.product_image
  add constraint uq_product_image_product_sort unique (product_id, sort_order);

-- 唯一約束自帶索引，0012 的普通索引成為冗餘
drop index if exists public.idx_product_image_product_sort;

-- =============================================================================
-- 2. insert_product_image()——原子取號插入
-- =============================================================================

create or replace function public.insert_product_image(
  p_product_id uuid,
  p_storage_path text
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  -- 取號與插入同一語句仍可能與並發者搶同號（READ COMMITTED 都讀到同一個 max），
  -- 由 unique 約束攔下、重讀重試。storage_path 是 UUID 路徑不會撞，
  -- 此處 unique_violation 必為 (product_id, sort_order)。
  for attempt in 1..3 loop
    begin
      insert into public.product_image (product_id, storage_path, sort_order)
      values (
        p_product_id,
        p_storage_path,
        (select coalesce(max(sort_order), -1) + 1
           from public.product_image
          where product_id = p_product_id)
      )
      returning id into v_id;
      return v_id;
    exception when unique_violation then
      null; -- 重試
    end;
  end loop;
  raise exception 'insert_product_image: 排序取號重試 3 次仍衝突';
end;
$$;

comment on function public.insert_product_image(uuid, text) is
  'T11：原子化「排最後」插入；並發搶號由 uq_product_image_product_sort 攔下後重試';

-- =============================================================================
-- 3. move_product_image()——原子交換排序
-- =============================================================================

create or replace function public.move_product_image(
  p_image_id uuid,
  p_direction text
) returns text  -- 'moved' | 'edge' | 'not_found'
language plpgsql
as $$
declare
  v_target public.product_image%rowtype;
  v_neighbor public.product_image%rowtype;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'move_product_image: 無效方向 %', p_direction;
  end if;

  select * into v_target
    from public.product_image
   where id = p_image_id
     for update;
  if not found then
    return 'not_found';
  end if;

  -- 鄰居也上鎖：兩個並發 move 只能依序執行，不會再交錯出重複值。
  -- （極端情況下不同鎖序可能死鎖，Postgres 會自動中止其一，呼叫端回報重試即可）
  if p_direction = 'down' then
    select * into v_neighbor
      from public.product_image
     where product_id = v_target.product_id
       and sort_order > v_target.sort_order
     order by sort_order asc
     limit 1
       for update;
  else
    select * into v_neighbor
      from public.product_image
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
  -- 全程單一交易，任何一步失敗整段 rollback，不再有「暫時同值」中間態
  update public.product_image
     set sort_order = -1 - v_target.sort_order
   where id = v_target.id;
  update public.product_image
     set sort_order = v_target.sort_order
   where id = v_neighbor.id;
  update public.product_image
     set sort_order = v_neighbor.sort_order
   where id = v_target.id;

  return 'moved';
end;
$$;

comment on function public.move_product_image(uuid, text) is
  'T11：原子交換相鄰兩張圖的 sort_order；row lock 序列化並發、交易保證無部分成功';
