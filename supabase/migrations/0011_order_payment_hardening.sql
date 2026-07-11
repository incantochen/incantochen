-- 0011: 訂單／付款加固（深度 code review 後續）
--
-- 1) create_order_with_items 收回 PostgREST 匿名執行權。
--    function 是 SECURITY INVOKER，今天 anon 呼叫會被 orders/order_item 的
--    RLS deny-by-default 擋下（已驗證不可利用），但所有金額參數都是呼叫端
--    自帶——防線只剩 RLS 這一層，未來任何人對 orders 加 INSERT policy 就會
--    靜默變成完整的驗價繞過（違反 §6 第一紅線）。比照 0002/0006/0009 的
--    revoke 慣例直接收回執行權，讓這條路徑永遠只有 service role 可走。
--    順手釘住 search_path（Supabase linter: function_search_path_mutable；
--    函式內引用皆已 schema-qualified，可安全設空）。
--
-- 2) orders 加 partial unique index：同一張 cart 同時間只能有一筆
--    pending_payment 訂單。應用層的 dedup 檢查是 check-then-act，併發雙
--    送出仍可能建出兩張可付款的訂單造成雙重扣款（§6：check-then-act 在
--    並發下必然有 race，一律以 DB 約束兜底——同 T70 cart.guest_token 教訓）。
--    歷史資料不受影響：0010 之前的訂單 cart_id 全為 null，不納入 partial index。
--
-- 還原（緊急回退，僅 local；正式環境改新增 drop migration）：
--   drop index if exists public.uq_orders_one_pending_per_cart;
--   grant execute on function public.create_order_with_items(
--     uuid, text, uuid, text, text, text, text, numeric, numeric, numeric,
--     boolean, timestamptz, jsonb) to anon, authenticated;

revoke execute on function public.create_order_with_items(
  uuid, text, uuid, text, text, text, text, numeric, numeric, numeric,
  boolean, timestamptz, jsonb
) from public, anon, authenticated;

alter function public.create_order_with_items(
  uuid, text, uuid, text, text, text, text, numeric, numeric, numeric,
  boolean, timestamptz, jsonb
) set search_path = '';

create unique index uq_orders_one_pending_per_cart
  on public.orders (cart_id)
  where status = 'pending_payment' and cart_id is not null;

comment on index public.uq_orders_one_pending_per_cart is
  '同一張 cart 同時間僅允許一筆 pending_payment 訂單——應用層 dedup 的 DB 兜底，'
  '防併發重複下單造成雙重扣款。';
