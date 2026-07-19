-- 0020: refund_order() 原子退款 RPC（T47；PR #86 code-review max/deep-domain 後續）
--
-- 動機：記錄式退款原本在 refund-order.ts 分兩次寫入——先翻 payment=refunded、
--   再 transitionOrder 轉 orders=refunded。兩者非原子：第二步遇持續性錯誤或
--   並發競態失手時，留下「payment=refunded ∧ order≠refunded」的半套狀態，
--   而 UI（hasPaidPayment=false）隱藏補救入口、reconcile 稽核臂只認 cancelled
--   → 金流矛盾無自癒、客人收不到退款信（兩份 code review 的主根因）。
--
-- 解法：仿 0017 transition_order_status，把「翻 paid payment ＋ CAS 轉訂單 ＋
--   寫稽核 log」三段包進單一 function（＝單一交易）。CAS 沒搶到一律 RAISE
--   （不是 return）——整筆交易 rollback，連同 payment 翻面一起還原，半套狀態 A
--   從源頭消失。呼叫端據自訂 SQLSTATE 分流（不靠脆弱的 message 比對）：
--     U0001＝p_from 為 refunded（重入應走 TS repair 路徑，非本 RPC）
--     U0002＝CAS 未命中（訂單狀態競態，整筆已 rollback、payment 未翻）
--
-- 冪等：payment 的 UPDATE 帶 status='paid' 條件，已翻過則 0 筆無害（legacy 半套
--   或並發已翻走時仍能推進訂單狀態）。存在性守衛（有無可退款 payment）留在
--   TS 端 findRefundablePayment，本 RPC 不重複。
--
-- 比照 0011/0017 慣例：revoke PostgREST 匿名執行權（只留 service role 路徑）＋
--   釘住 search_path（函式內引用皆 schema-qualified）。p_note／p_actor_id 給
--   default null（gen types 標 optional，呼叫端省略即 null）。
--
-- 還原（緊急回退，僅 local；正式環境改新增 drop migration）：
--   drop function if exists public.refund_order(
--     uuid, public.order_status, text, uuid);

create or replace function public.refund_order(
  p_order_id uuid,
  p_from public.order_status,
  p_note text default null,
  p_actor_id uuid default null
) returns setof public.orders
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  -- 重入（訂單已 refunded，如 Admin Override 逃生口留下 payment=paid 的半套）
  -- 沒有狀態轉換可做，屬 TS 端 repair 路徑職責；誤入本 RPC 直接擋下。
  if p_from = 'refunded' then
    raise exception 'refund_order: p_from 不可為 refunded（重入走 repair 路徑）'
      using errcode = 'U0001';
  end if;

  -- 1) 翻 paid payment（冪等：已翻過/並發翻走則 0 筆，無害）。條件式 UPDATE
  --    帶 status='paid' 且 SET 改動該欄位，符合 CLAUDE.md §6 CAS 規則。
  update public.payment
     set status = 'refunded'
   where order_id = p_order_id and status = 'paid';

  -- 2) CAS 轉訂單 p_from → refunded
  update public.orders
     set status = 'refunded'
   where id = p_order_id and status = p_from
  returning * into v_order;

  -- 關鍵：CAS 沒搶到就 RAISE（不是 return）。transition_order_status 在 CAS
  -- miss 時 return 空集合是安全的（它之前沒有其他寫入）；本 RPC 在 CAS 前已
  -- 翻 payment，若 return 則 payment 翻面會隨外層交易 commit＝重演半套狀態。
  -- raise 令整筆交易 abort，payment 翻面一併 rollback。
  if not found then
    raise exception 'refund_order: 訂單狀態競態，CAS 未命中（from=%）', p_from
      using errcode = 'U0002';
  end if;

  -- 3) 稽核 log（與狀態轉換同交易，任一失敗整段 rollback）
  insert into public.order_status_log
    (order_id, from_status, to_status, note, actor_id, is_override)
  values
    (p_order_id, p_from::text, 'refunded', p_note, p_actor_id, false);

  return next v_order;
end;
$$;

comment on function public.refund_order(
  uuid, public.order_status, text, uuid
) is
  'T47 原子退款：翻 paid payment + CAS UPDATE orders → refunded + INSERT
   order_status_log 於單一交易內完成，CAS 未命中 raise（U0002）令整筆 rollback、
   payment 翻面一併還原——消滅「payment=refunded、order≠refunded」半套狀態。
   存在性守衛（有無可退款 payment）在 TS 端 findRefundablePayment；訂單已 refunded
   的重入（U0001）走 TS repair 路徑，非本 RPC。直接呼叫等同 override 級操作。';

revoke execute on function public.refund_order(
  uuid, public.order_status, text, uuid
) from public, anon, authenticated;
