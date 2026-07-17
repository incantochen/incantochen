-- 0017: transition_order_status() RPC（T110）
-- T92 code review 發現：transitionOrder／adminOverrideStatus／ensureOrderPaid
--   各自手刻「CAS UPDATE orders → INSERT order_status_log」且失敗處理已分歧。
--   CAS 成功但 log INSERT 失敗時，訂單狀態已變、稽核記錄永久缺漏——T92 的
--   to===from 前置守衛更讓「同目標重試補 log」的僥倖路徑消失。
-- 仿 0010 create_order_with_items：兩段寫入包進單一 function（＝單一交易），
--   任一失敗整段自動 rollback，呼叫端重試時 CAS 重新來過，徹底消滅
--   「狀態已變、log 缺漏」的中間態。
-- 比照 0011 慣例：revoke PostgREST 匿名執行權（只留 service role 路徑）＋
--   釘住 search_path（函式內引用皆 schema-qualified）。
-- p_note／p_actor_id 給 default null：gen types 會把有預設值的參數標成
--   optional（p_note?: string），呼叫端「省略」即為 null——若改成必填參數、
--   呼叫端傳 null，生成型別（string，不含 null）會擋下。手改型別檔又會在
--   下次 regen 被打回原形，故從 SQL 端解。
-- 還原（緊急回退，僅 local；正式環境改新增 drop migration）：
--   drop function if exists public.transition_order_status(
--     uuid, public.order_status, public.order_status, boolean, text, uuid);

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_from public.order_status,
  p_to public.order_status,
  p_is_override boolean,
  p_note text default null,
  p_actor_id uuid default null
) returns setof public.orders
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  -- to = from 時 CAS 守衛在 READ COMMITTED 下失效（EvalPlanQual，CLAUDE.md §6）；
  -- TS 端已各自擋下，這裡再守一層，護欄不依賴呼叫端記得。
  if p_from = p_to then
    raise exception 'transition_order_status: from 與 to 相同（%）', p_to;
  end if;

  update public.orders
     set status = p_to
   where id = p_order_id and status = p_from
  returning * into v_order;

  if not found then
    return;  -- CAS 沒搶到：回空集合，不寫 log
  end if;

  insert into public.order_status_log
    (order_id, from_status, to_status, note, actor_id, is_override)
  values
    (p_order_id, p_from::text, p_to::text, p_note, p_actor_id, p_is_override);

  return next v_order;
end;
$$;

comment on function public.transition_order_status(
  uuid, public.order_status, public.order_status, boolean, text, uuid
) is
  'T110：訂單狀態轉換交易化——CAS UPDATE orders + INSERT order_status_log 單一
   function 內完成，任一段失敗整段自動 rollback。CAS 沒搶到回空集合（呼叫端以
   maybeSingle 判別）。returns setof 而非單一 composite：composite 回 NULL 時
   PostgREST 會序列化成全 null 欄位物件，難與真實列區分。
   注意：本 function 刻意不驗證轉換合法性（VALID_TRANSITIONS 單一出處在 TS 端
   state-machine.ts）——非 override 的合法性守衛由 transitionOrder 負責，它是
   唯一被認可的非 override 呼叫入口；直接呼叫本 RPC 等同 override 級操作。';

revoke execute on function public.transition_order_status(
  uuid, public.order_status, public.order_status, boolean, text, uuid
) from public, anon, authenticated;
