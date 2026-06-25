-- =============================================================================
-- verify-seed.sql — T43 dev seed 驗收查詢
-- 用途：Claude Code 跑完 seed 後自行執行，確認資料正確性
-- 執行方式：
--   supabase db execute --local < docs/verify-seed.sql
-- 或在 psql 裡直接貼入
-- =============================================================================

-- § 1. 各表筆數（預期值標註於註解）
SELECT
  (SELECT COUNT(*) FROM public.product)               AS products,           -- 預期：1
  (SELECT COUNT(*) FROM public.option_type)           AS option_types,       -- 預期：3
  (SELECT COUNT(*) FROM public.option_value)          AS option_values,      -- 預期：8
  (SELECT COUNT(*) FROM public.product_option)        AS product_options,    -- 預期：3
  (SELECT COUNT(*) FROM public.product_option_value)  AS product_option_values; -- 預期：8

-- § 2. 商品基本資料
SELECT slug, name, category, base_price, status
FROM public.product;
-- 預期：emerald-solitaire-ring | 祖母綠單石戒指 | ring | 25000 | active

-- § 3. 選項類型與適用品類
-- 註：option_type 無 sort_order 欄位（schema 未定義），改用 code 排序
SELECT code, name, applies_to, input_type
FROM public.option_type
ORDER BY code;
-- 預期：gem_color(swatch) / metal_color(swatch) / ring_size(select)

-- § 4. 完整白名單：商品 × 選項 × 值 × 加價（最重要的驗收）
SELECT
  ot.code        AS option_type,
  ov.code        AS value_code,
  ov.label       AS value_label,
  pov.price_delta,
  pov.is_default
FROM public.product p
JOIN public.product_option     po  ON po.product_id      = p.id
JOIN public.option_type        ot  ON ot.id              = po.option_type_id
JOIN public.product_option_value pov ON pov.product_option_id = po.id
JOIN public.option_value       ov  ON ov.id              = pov.option_value_id
WHERE p.slug = 'emerald-solitaire-ring'
ORDER BY po.sort_order, ov.sort_order;

-- 預期輸出（8 列）：
-- gem_color   | emerald    | 祖母綠   |     0 | true
-- gem_color   | sapphire   | 藍寶石   |  2000 | false
-- gem_color   | ruby       | 紅寶石   |  3000 | false
-- metal_color | 18k-yellow | 18K 黃金 |     0 | true
-- metal_color | 18k-white  | 18K 白金 |  1000 | false
-- ring_size   | size-10    | #10      |     0 | true
-- ring_size   | size-11    | #11      |     0 | false
-- ring_size   | size-12    | #12      |     0 | false

-- § 5. 白名單三層完整性檢查（有任何空值代表外鍵對不上）
SELECT
  p.slug,
  po.id IS NOT NULL AS has_product_option,
  pov.id IS NOT NULL AS has_product_option_value
FROM public.product p
LEFT JOIN public.product_option po ON po.product_id = p.id
LEFT JOIN public.product_option_value pov ON pov.product_option_id = po.id
WHERE p.slug = 'emerald-solitaire-ring';
-- 預期：全部 true（8 列）

-- =============================================================================
-- 全部通過 → T43 ✅，可進 T15 戒指商品詳情頁
-- 有任何 null 或筆數不符 → 回報錯誤訊息，不進下一任務
-- =============================================================================
