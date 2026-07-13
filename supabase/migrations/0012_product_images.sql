-- 0012: 圖片基礎設施（T11）——product_image 表＋option_value 圖片欄位＋Storage bucket
-- 設計要點：
--   • product_image 為第 16 張表（使用者核准破例，2026-07-13）。
--   • FK 走 CASCADE：商品圖＝設定圖（非帳務證據），隨商品刪除（0001 外鍵策略）。
--   • storage_path / image_path 一律只存 Storage 內相對路徑（如 {productId}/{uuid}.webp），
--     不存完整 URL——顯示時由 src/lib/storage 組公開 URL，換專案/網域不需改資料。
--   • sort_order 不保證連續（0、3、8、15 皆合法），排序語意只看相對大小；
--     調整順序只交換兩筆，禁止全量 reindex。
--   • 寫入全走 service role：無 insert/update/delete policy（0002 deny-by-default 慣例）。

-- =============================================================================
-- 1. product_image
-- =============================================================================

create table public.product_image (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.product (id) on delete cascade,
  storage_path text not null unique check (storage_path <> ''),
  alt          text not null default '',
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table  public.product_image is '商品圖（T11）；檔案存 Storage bucket product-images';
comment on column public.product_image.storage_path is
  'Storage 內相對路徑（{productId}/{uuid}.{ext}），不含 bucket 名與網域；公開 URL 由 lib 組出';
comment on column public.product_image.sort_order is
  '排序只看相對大小，不保證連續；交換順序只更新兩筆，禁止全量 reindex';

create index idx_product_image_product_sort
  on public.product_image (product_id, sort_order);

create trigger trg_product_image_updated_at
  before update on public.product_image
  for each row execute function public.set_updated_at();  -- 0001 既有 function

alter table public.product_image enable row level security;

-- 公開唯讀：僅所屬商品 active 時外露（對齊 0002 product_select_public）
create policy product_image_select_public on public.product_image
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.product p
      where p.id = product_id and p.status = 'active'
    )
  );

-- =============================================================================
-- 2. option_value 圖片欄位（swatch 色票＋選項對應圖；上傳 UI 留 T12）
--    既有 option_value_select_public（using true）自動涵蓋新欄位，RLS 不需動。
-- =============================================================================

alter table public.option_value
  add column swatch_hex text null check (swatch_hex ~ '^#[0-9A-Fa-f]{6}$'),
  add column image_path text null;

comment on column public.option_value.swatch_hex is
  '色票色碼（#RRGGBB）；swatch 型選項的前台顯示色';
comment on column public.option_value.image_path is
  'Storage 內相對路徑，不存完整 URL（同 product_image.storage_path 慣例）；上傳 UI 見 T12';

-- =============================================================================
-- 3. Storage bucket：product-images（公開讀；寫入走 service role，
--    不開任何 storage.objects policy）
--    注意：on conflict do nothing——bucket 已存在時不覆蓋設定；日後要改
--    file_size_limit / allowed_mime_types 等，須開新 migration 用 update 更新，
--    不能回頭改本檔。
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,  -- 5MB，與應用層 MAX_FILE_SIZE 一致（src/lib/storage/constants.ts）
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do nothing;
