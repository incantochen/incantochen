-- 0025: 重補 create_order_with_items 的執行權收回＋search_path 釘定（T137 後續）
--
-- 0024 以 drop+create 重建 create_order_with_items（新增 p_delivery_method 參數）。
-- Postgres 建立全新函式物件時「不保留」被 drop 舊物件的權限與設定，故 0011
-- 對本函式做的兩道加固一併消失：
--   1) revoke execute ... from public, anon, authenticated（把這支金額參數全由
--      呼叫端自帶的 SECURITY INVOKER 函式鎖成只有 service role 可走——防「日後
--      有人對 orders 加 INSERT policy 就靜默變成驗價繞過」，§6 第一紅線的深度
--      防禦層）。0024 後新函式恢復預設 EXECUTE to PUBLIC（anon/authenticated 繼承）。
--   2) set search_path = ''（Supabase linter: function_search_path_mutable）。
-- 0024 已套用於 production、不可改，故對新的 14 參數簽章獨立補一支 migration。
-- 背景與原始理由見 0011_order_payment_hardening.sql。
--
-- 還原（緊急回退，僅 local；正式環境改新增 migration）：
--   grant execute on function public.create_order_with_items(
--     uuid, text, uuid, text, text, text, text, text, numeric, numeric, numeric,
--     boolean, timestamptz, jsonb) to anon, authenticated;

revoke execute on function public.create_order_with_items(
  uuid, text, uuid, text, text, text, text, text, numeric, numeric, numeric,
  boolean, timestamptz, jsonb
) from public, anon, authenticated;

alter function public.create_order_with_items(
  uuid, text, uuid, text, text, text, text, text, numeric, numeric, numeric,
  boolean, timestamptz, jsonb
) set search_path = '';
