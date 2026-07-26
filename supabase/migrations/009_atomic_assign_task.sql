-- Phase 05 Task 1 follow-up — 008's next_sort_key() didn't actually close audit C3.
--
-- pg_advisory_xact_lock is transaction-scoped, and the RPC call was its own transaction: the lock
-- acquired, MAX was read, the value returned, and the lock released, ALL before the app made its
-- separate .insert() call. Two concurrent assigns for the same member could both complete their
-- (locked) read of the same stale MAX before either had inserted, and both land on the same key —
-- the exact race 008 was meant to prevent, just moved one step later.
--
-- FIX: fold the read AND the insert into one function, so the lock is held across both. Concurrent
-- calls for the same member now serialize on the insert, not just the read.
--
-- Same grant posture as 008: lives in `public` for PostgREST exposure, EXECUTE restricted to
-- service_role only (the server actions are the only legitimate caller).

create or replace function public.assign_task_member(p_task_id uuid, p_member_id uuid)
returns public.task_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.task_assignments;
begin
  perform pg_advisory_xact_lock(hashtext(p_member_id::text));

  insert into public.task_assignments (task_id, member_id, member_sort_key)
  select
    p_task_id,
    p_member_id,
    coalesce(max(member_sort_key), 0) + 1000
  from public.task_assignments
  where member_id = p_member_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.assign_task_member(uuid, uuid) from public;
revoke execute on function public.assign_task_member(uuid, uuid) from anon;
revoke execute on function public.assign_task_member(uuid, uuid) from authenticated;
grant execute on function public.assign_task_member(uuid, uuid) to service_role;

-- Superseded: computing the key and inserting were two round trips from the app, which is the bug
-- above. No other caller exists.
drop function if exists public.next_sort_key(uuid);
