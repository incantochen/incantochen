-- =============================================================================
-- incantochen MVP — seed.sql（dev 種子資料）
-- 對應任務：T43（手動塞戒指種子資料）
-- 用途：本機開發 / local stack 用，提供配置器（T15/T16）所需的最小資料集
-- -----------------------------------------------------------------------------
-- 執行方式：
--   supabase db reset --local   ← 重置本機 DB 並自動跑此 seed
--   或直接：supabase db seed     ← 僅跑 seed（不重置）
-- -----------------------------------------------------------------------------
-- 冪等設計：使用固定 UUID（gen_random_uuid() 在此不適用）＋ ON CONFLICT DO NOTHING
-- 讓 seed 可重複執行，不會重複插入。
-- -----------------------------------------------------------------------------
-- 資料集：
--   1 款戒指商品（emerald-solitaire-ring，底價 NT$25,000）
--   OptionType × 3：gem_color / metal_color / ring_size
--   OptionValue × 8：3 寶石色 / 2 金屬色 / 3 戒圍
--   ProductOption × 3：全數掛到此款戒指
--   ProductOptionValue × 8：白名單＋加價（部分有 default）
-- =============================================================================


-- =============================================================================
-- § 固定 UUID 常數（CTE 形式，讓整支 SQL 易於追蹤）
-- =============================================================================
-- 用法：在 WITH 區塊內定義常數，各 INSERT 透過 CTE 取值，不散落硬編碼。
-- UUID 是手動生成的固定值；若需要更換款式或選項，只改此區塊。
-- =============================================================================

WITH
  -- ── 商品 ──
  ids_product AS (
    SELECT
      '11111111-0000-4000-a000-000000000001'::uuid AS ring_id
  ),

  -- ── OptionType ──
  ids_option_type AS (
    SELECT
      '22222222-0000-4000-a000-000000000001'::uuid AS gem_color_id,
      '22222222-0000-4000-a000-000000000002'::uuid AS metal_color_id,
      '22222222-0000-4000-a000-000000000003'::uuid AS ring_size_id
  ),

  -- ── OptionValue（寶石色）──
  ids_gem AS (
    SELECT
      '33333333-0000-4000-a000-000000000001'::uuid AS emerald_id,
      '33333333-0000-4000-a000-000000000002'::uuid AS sapphire_id,
      '33333333-0000-4000-a000-000000000003'::uuid AS ruby_id
  ),

  -- ── OptionValue（金屬色）──
  ids_metal AS (
    SELECT
      '33333333-0000-4000-a000-000000000011'::uuid AS yellow_id,
      '33333333-0000-4000-a000-000000000012'::uuid AS white_id
  ),

  -- ── OptionValue（戒圍）──
  ids_size AS (
    SELECT
      '33333333-0000-4000-a000-000000000021'::uuid AS size10_id,
      '33333333-0000-4000-a000-000000000022'::uuid AS size11_id,
      '33333333-0000-4000-a000-000000000023'::uuid AS size12_id
  ),

  -- ── ProductOption（此款戒指綁哪些 OptionType）──
  ids_product_option AS (
    SELECT
      '44444444-0000-4000-a000-000000000001'::uuid AS po_gem_id,
      '44444444-0000-4000-a000-000000000002'::uuid AS po_metal_id,
      '44444444-0000-4000-a000-000000000003'::uuid AS po_size_id
  ),


-- =============================================================================
-- § 1. 商品（product）
-- =============================================================================
  inserted_product AS (
    INSERT INTO public.product (id, slug, name, category, base_price, status)
    SELECT
      ring_id,
      'emerald-solitaire-ring',
      '祖母綠單石戒指',
      'ring',
      25000,   -- NT$ 底價，選配加價另計
      'active'
    FROM ids_product
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  ),


-- =============================================================================
-- § 2. 選項類型（option_type）
--   code          name        applies_to   input_type
--   gem_color     寶石顏色     ring         swatch
--   metal_color   金屬色       ring         swatch
--   ring_size     戒圍         ring         select
-- =============================================================================
  inserted_option_types AS (
    INSERT INTO public.option_type (id, code, name, applies_to, input_type)
    SELECT id, code, name, applies_to::option_applies_to, input_type
    FROM (
      SELECT gem_color_id   AS id, 'gem_color'   AS code, '寶石顏色' AS name, 'ring' AS applies_to, 'swatch' AS input_type FROM ids_option_type
      UNION ALL
      SELECT metal_color_id AS id, 'metal_color' AS code, '金屬色'   AS name, 'ring' AS applies_to, 'swatch' AS input_type FROM ids_option_type
      UNION ALL
      SELECT ring_size_id   AS id, 'ring_size'   AS code, '戒圍'     AS name, 'ring' AS applies_to, 'select' AS input_type FROM ids_option_type
    ) AS t
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  ),


-- =============================================================================
-- § 3. 選項值（option_value）
--   寶石色：祖母綠 / 藍寶石 / 紅寶石
--   金屬色：18K 黃金 / 18K 白金
--   戒圍：10 / 11 / 12（台灣常見尺寸）
-- =============================================================================
  inserted_option_values AS (
    INSERT INTO public.option_value (id, option_type_id, code, label, sort_order)
    SELECT id, option_type_id, code, label, sort_order
    FROM (
      -- 寶石色
      SELECT emerald_id  AS id, gem_color_id AS option_type_id, 'emerald'  AS code, '祖母綠' AS label, 1 AS sort_order FROM ids_gem, ids_option_type
      UNION ALL
      SELECT sapphire_id AS id, gem_color_id AS option_type_id, 'sapphire' AS code, '藍寶石' AS label, 2 AS sort_order FROM ids_gem, ids_option_type
      UNION ALL
      SELECT ruby_id     AS id, gem_color_id AS option_type_id, 'ruby'     AS code, '紅寶石' AS label, 3 AS sort_order FROM ids_gem, ids_option_type
      -- 金屬色
      UNION ALL
      SELECT yellow_id   AS id, metal_color_id AS option_type_id, '18k-yellow' AS code, '18K 黃金' AS label, 1 AS sort_order FROM ids_metal, ids_option_type
      UNION ALL
      SELECT white_id    AS id, metal_color_id AS option_type_id, '18k-white'  AS code, '18K 白金' AS label, 2 AS sort_order FROM ids_metal, ids_option_type
      -- 戒圍
      UNION ALL
      SELECT size10_id   AS id, ring_size_id AS option_type_id, 'size-10' AS code, '#10' AS label, 1 AS sort_order FROM ids_size, ids_option_type
      UNION ALL
      SELECT size11_id   AS id, ring_size_id AS option_type_id, 'size-11' AS code, '#11' AS label, 2 AS sort_order FROM ids_size, ids_option_type
      UNION ALL
      SELECT size12_id   AS id, ring_size_id AS option_type_id, 'size-12' AS code, '#12' AS label, 3 AS sort_order FROM ids_size, ids_option_type
    ) AS t
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  ),


-- =============================================================================
-- § 4. 商品×選項綁定（product_option）
--   將 gem_color / metal_color / ring_size 全數掛到「祖母綠單石戒指」
-- =============================================================================
  inserted_product_options AS (
    INSERT INTO public.product_option (id, product_id, option_type_id, required, sort_order)
    SELECT id, product_id, option_type_id, required, sort_order
    FROM (
      SELECT po_gem_id   AS id, ring_id AS product_id, gem_color_id   AS option_type_id, true AS required, 1 AS sort_order FROM ids_product_option, ids_product, ids_option_type
      UNION ALL
      SELECT po_metal_id AS id, ring_id AS product_id, metal_color_id AS option_type_id, true AS required, 2 AS sort_order FROM ids_product_option, ids_product, ids_option_type
      UNION ALL
      SELECT po_size_id  AS id, ring_id AS product_id, ring_size_id   AS option_type_id, true AS required, 3 AS sort_order FROM ids_product_option, ids_product, ids_option_type
    ) AS t
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  ),


-- =============================================================================
-- § 5. 商品選項值白名單（product_option_value）
--   price_delta：選此值的加價（NT$ 整數元）
--   is_default：配置器預設選中
--
--   gem_color（掛 po_gem_id）：
--     emerald   +0     default ← 商品主打祖母綠，設為預設
--     sapphire  +2000
--     ruby      +3000
--
--   metal_color（掛 po_metal_id）：
--     18k-yellow  +0    default
--     18k-white   +1000
--
--   ring_size（掛 po_size_id）：
--     size-10  +0  default（常見起始尺寸）
--     size-11  +0
--     size-12  +0
-- =============================================================================
  inserted_product_option_values AS (
    INSERT INTO public.product_option_value (product_option_id, option_value_id, price_delta, is_default)
    SELECT product_option_id, option_value_id, price_delta, is_default
    FROM (
      -- 寶石色
      SELECT po_gem_id AS product_option_id, emerald_id  AS option_value_id, 0    AS price_delta, true  AS is_default FROM ids_product_option, ids_gem
      UNION ALL
      SELECT po_gem_id AS product_option_id, sapphire_id AS option_value_id, 2000 AS price_delta, false AS is_default FROM ids_product_option, ids_gem
      UNION ALL
      SELECT po_gem_id AS product_option_id, ruby_id     AS option_value_id, 3000 AS price_delta, false AS is_default FROM ids_product_option, ids_gem
      -- 金屬色
      UNION ALL
      SELECT po_metal_id AS product_option_id, yellow_id AS option_value_id, 0    AS price_delta, true  AS is_default FROM ids_product_option, ids_metal
      UNION ALL
      SELECT po_metal_id AS product_option_id, white_id  AS option_value_id, 1000 AS price_delta, false AS is_default FROM ids_product_option, ids_metal
      -- 戒圍
      UNION ALL
      SELECT po_size_id AS product_option_id, size10_id AS option_value_id, 0 AS price_delta, true  AS is_default FROM ids_product_option, ids_size
      UNION ALL
      SELECT po_size_id AS product_option_id, size11_id AS option_value_id, 0 AS price_delta, false AS is_default FROM ids_product_option, ids_size
      UNION ALL
      SELECT po_size_id AS product_option_id, size12_id AS option_value_id, 0 AS price_delta, false AS is_default FROM ids_product_option, ids_size
    ) AS t
    ON CONFLICT (product_option_id, option_value_id) DO NOTHING
    RETURNING product_option_id
  )


-- =============================================================================
-- § 最終 SELECT（確認各階段插入筆數，便於驗收）
-- =============================================================================
SELECT
  (SELECT COUNT(*) FROM inserted_product)              AS products_inserted,
  (SELECT COUNT(*) FROM inserted_option_types)         AS option_types_inserted,
  (SELECT COUNT(*) FROM inserted_option_values)        AS option_values_inserted,
  (SELECT COUNT(*) FROM inserted_product_options)      AS product_options_inserted,
  (SELECT COUNT(*) FROM inserted_product_option_values) AS product_option_values_inserted;

-- =============================================================================
-- seed.sql 結束
-- 預期輸出（首次執行）：
--   products_inserted=1, option_types=3, option_values=8,
--   product_options=3, product_option_values=8
-- 重複執行：全部為 0（ON CONFLICT DO NOTHING，冪等）
-- -----------------------------------------------------------------------------
-- 下一步：T15 戒指商品詳情頁（前置 T43 ✅、T39 進行中）
--   supabase db reset --local  ← 本機套用並跑 seed
--   或  supabase db seed        ← 只跑 seed（不 reset）
-- =============================================================================
