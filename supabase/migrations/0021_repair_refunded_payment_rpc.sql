-- 0021: repair_refunded_payment() —— Override 半套狀態的原子補登記（T47 後續；
--        PR #86 deep-domain 審查候選 A）
--
-- 背景：Admin Override 逃生口把訂單 paid→refunded 時不翻 payment、不寄信，留下
--   order=refunded ∧ payment=paid 的半套狀態（refund-section 的 needsPaymentRepair）。
--   原 TS 端 repairRefundedOrderPayment 以兩次非原子寫入收拾（payment 翻面 →
--   order_status_log insert）：log insert 若在翻面 commit 後失敗，重試會因 payment
--   已 refunded（flipped=0）跳過 log → 必填 reason 永久遺失＋回報假成功。與本 PR
--   主路徑（0020 原子 RPC）同一類「兩次寫入留半套」缺陷，這裡一併收乾淨。
--
-- 比照 0017/0020：CAS 條件式 UPDATE ＋ 稽核 log 於單一交易（任一失敗整段 rollback）；
--   revoke 匿名執行權；釘 search_path；p_note/p_actor_id default null。回傳補翻筆數
--   （0＝已一致、>0＝確有補翻）供呼叫端判斷。
--
-- log 註記慣例：呼叫端傳入的 p_note 已含 `[退款補登記]` 前綴（單一出處在 TS 端
--   refund-order.ts）；配合 from=to=refunded 同狀態列＋is_override=true，後台時間軸
--   一眼可辨用途，並可 `note like '[退款補登記]%'` grep 撈出所有補登記事件。
--
-- 還原（緊急回退，僅 local；正式環境改新增 drop migration）：
--   drop function if exists public.repair_refunded_payment(uuid, text, uuid);

create or replace function public.repair_refunded_payment(
  p_order_id uuid,
  p_note text default null,
  p_actor_id uuid default null
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_flipped integer;
begin
  -- 補翻殘留的 paid payment（條件式 UPDATE，帶 status='paid' 且 SET 改動該欄位，
  -- CLAUDE.md §6 CAS 規則；並發雙擊只有一筆搶到）。
  update public.payment
     set status = 'refunded'
   where order_id = p_order_id and status = 'paid';
  get diagnostics v_flipped = row_count;

  -- 只在確實補翻了 payment 時寫稽核註記——與翻面同交易，任一失敗整段 rollback，
  -- 消滅「payment 已翻、reason 稽核遺失」的半套。避免重複點擊／已一致時灌空 log。
  if v_flipped > 0 then
    insert into public.order_status_log
      (order_id, from_status, to_status, note, actor_id, is_override)
    values
      (p_order_id, 'refunded', 'refunded', p_note, p_actor_id, true);
  end if;

  return v_flipped;
end;
$$;

comment on function public.repair_refunded_payment(uuid, text, uuid) is
  'T47：Override 逃生口留下的 order=refunded ∧ payment=paid 半套狀態的原子補登記
   ——補翻 paid payment＋（有翻才）寫 order_status_log 於單一交易，消滅「payment
   已翻、reason 稽核遺失」的兩次非原子寫入缺口。p_note 由呼叫端組（含 [退款補登記]
   前綴）。回傳補翻筆數。';

revoke execute on function public.repair_refunded_payment(uuid, text, uuid)
  from public, anon, authenticated;
