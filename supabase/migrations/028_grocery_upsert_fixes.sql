-- supabase/migrations/028_grocery_upsert_fixes.sql
--
-- Two defects in 027's grocery_upsert, fixed as a new create or replace rather than an edit to
-- 027 (already applied to dev and recorded in migration history — tasks/lessons.md L9).
--
-- 1. `p_target not in ('stock','list')` is NULL, not true, when p_target is NULL, so the guard
--    never fires; v_stock then becomes NULL and the insert fails on the in_stock NOT NULL
--    constraint with a raw Postgres error instead of this function's own message.
-- 2. The conflict branch let a client's own-NULL quantity/expiry clobber a tracked pantry row:
--    re-adding an item already in stock, without a quantity, wiped out the quantity and date the
--    first add had recorded. Fixed by falling back to the existing row's value when the incoming
--    one is null, and by keeping expires_on and expiry_is_estimate as one unit so they can never
--    disagree (an estimate flag with no date, or a date with a stale flag).
create or replace function public.grocery_upsert(
  p_workspace  uuid,
  p_name       text,
  p_category   text,
  p_target     text,
  p_quantity   int     default null,
  p_expires_on date    default null,
  p_estimate   boolean default false,
  p_member     uuid    default null
)
returns public.grocery_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.grocery_items;
  v_stock   boolean := p_target = 'stock';
begin
  if p_target is null or p_target not in ('stock', 'list') then
    raise exception 'p_target must be stock or list';
  end if;

  insert into public.grocery_items as g (
    workspace_id, name, category, in_stock, needed,
    quantity, expires_on, expiry_is_estimate, added_by_member_id
  )
  values (
    p_workspace, btrim(p_name), p_category, v_stock, not v_stock,
    case when v_stock then p_quantity end,
    case when v_stock then p_expires_on end,
    case when v_stock and p_expires_on is not null then p_estimate else false end,
    p_member
  )
  on conflict (workspace_id, lower(btrim(name))) do update
    set category           = excluded.category,
        in_stock           = g.in_stock or excluded.in_stock,
        needed             = g.needed or excluded.needed,
        quantity           = case when excluded.in_stock
                                  then coalesce(excluded.quantity, g.quantity)
                                  else g.quantity end,
        expires_on         = case when excluded.in_stock and excluded.expires_on is not null
                                  then excluded.expires_on
                                  else g.expires_on end,
        expiry_is_estimate = case when excluded.in_stock and excluded.expires_on is not null
                                  then excluded.expiry_is_estimate
                                  else g.expiry_is_estimate end,
        times_added        = g.times_added + 1
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from public;
revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from anon;
revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from authenticated;
grant  execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) to service_role;
