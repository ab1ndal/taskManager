-- Phase 05 Task 1 — Fix audit C3: nextSortKey() was a read-then-write race (SELECT MAX, then
-- INSERT +1000, as two separate round trips from the app). Two concurrent task creations (or
-- assignee adds) for the same member could read the same MAX and both insert the same key.
--
-- FIX: move the read+compute into a single Postgres function serialized by a per-member advisory
-- transaction lock. Concurrent calls for the SAME member now block on the lock instead of racing;
-- concurrent calls for DIFFERENT members never contend (different lock keys via hashtext).
--
-- Lives in `public` (required so PostgREST exposes it as an RPC endpoint the admin client can
-- call), but EXECUTE is revoked from anon/authenticated and granted only to service_role — the
-- server actions are the only legitimate caller. See 007's header for why an exposed
-- SECURITY DEFINER function must restrict its own grants rather than rely on schema hiding.

create or replace function public.next_sort_key(p_member_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key numeric;
begin
  perform pg_advisory_xact_lock(hashtext(p_member_id::text));

  select coalesce(max(member_sort_key), 0) + 1000
  into v_key
  from public.task_assignments
  where member_id = p_member_id;

  return v_key;
end;
$$;

revoke execute on function public.next_sort_key(uuid) from public;
revoke execute on function public.next_sort_key(uuid) from anon;
revoke execute on function public.next_sort_key(uuid) from authenticated;
grant execute on function public.next_sort_key(uuid) to service_role;
