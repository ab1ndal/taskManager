-- supabase/migrations/027_grocery_rpcs.sql
--
-- Every grocery state transition, as a function.
--
-- Three reasons this is not a set of table writes from the client:
--
-- 1. The check constraints in 026 reject partial updates. Sending
--    `set in_stock = false, needed = true` violates grocery_items_qty_in_stock whenever a quantity
--    is set and grocery_items_expiry_stock whenever an expiry is, so "finished" is a five-column
--    write that has to happen in one statement.
-- 2. "Add to the list" is a check-then-insert race between two phones. The fix is
--    `on conflict … do update`, and the conflict target is an expression index, which PostgREST
--    cannot name — so the upsert must live here.
-- 3. The quantity stepper loses updates if it reads then writes. Nothing catches it, because the
--    losing value is perfectly valid. See tasks/lessons.md L10.
--
-- No function below calls current_date. These connections run in UTC, so current_date is already
-- tomorrow for the whole Pacific evening; the caller computes the local date (localToday() in
-- src/app/groceries/categories.ts) and passes it in.

-- Adds a product, or brings an existing one back.
--
-- p_target is 'stock' (we have it) or 'list' (we need it). The conflict branch is additive on
-- purpose: adding something to the list while it sits in the pantry sets `needed` and leaves
-- `in_stock` alone, which is the low-stock case, not an error.
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
  if p_target not in ('stock', 'list') then
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
        quantity           = case when excluded.in_stock then excluded.quantity
                                  else g.quantity end,
        expires_on         = case when excluded.in_stock then excluded.expires_on
                                  else g.expires_on end,
        expiry_is_estimate = case when excluded.in_stock then excluded.expiry_is_estimate
                                  else g.expiry_is_estimate end,
        times_added        = g.times_added + 1
  returning * into v_row;

  return v_row;
end;
$$;

-- The one-tap Need toggle. Idempotent, so two phones tapping it converge instead of clobbering.
create or replace function public.grocery_set_needed(p_id uuid, p_needed boolean)
returns public.grocery_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.grocery_items;
begin
  update public.grocery_items
     set needed = p_needed
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;

  return v_row;
end;
$$;

-- Bought: back into the pantry, off the list, expiry written in the same statement.
create or replace function public.grocery_mark_bought(
  p_id         uuid,
  p_expires_on date    default null,
  p_estimate   boolean default false
)
returns public.grocery_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.grocery_items;
begin
  update public.grocery_items
     set in_stock           = true,
         needed             = false,
         expires_on         = p_expires_on,
         expiry_is_estimate = p_expires_on is not null and p_estimate
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;

  return v_row;
end;
$$;

-- Finished: five columns at once, which is the write the constraints reject piecemeal.
-- p_keep_on_list false leaves both flags false — archived, still there for autocomplete.
create or replace function public.grocery_finish(p_id uuid, p_keep_on_list boolean)
returns public.grocery_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.grocery_items;
begin
  update public.grocery_items
     set in_stock           = false,
         needed             = p_keep_on_list,
         quantity           = null,
         expires_on         = null,
         expiry_is_estimate = false
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;

  return v_row;
end;
$$;

-- The stepper.
--
-- `for update` locks the single row so two concurrent decrements serialise and both land — the
-- plain read-then-write version loses one silently. The zero crossing runs inside this same call
-- rather than returning 1 and letting the client send a second write, which is exactly the split
-- lesson L10 records: the read and every write depending on it share one transaction.
--
-- Note this is a single-row lock, not the aggregate-query `for update` that migration 021 had to
-- undo.
create or replace function public.grocery_adjust_quantity(p_id uuid, p_delta int)
returns public.grocery_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity int;
  v_row      public.grocery_items;
begin
  select quantity into v_quantity
  from public.grocery_items
  where id = p_id
  for update;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;

  if v_quantity is null then
    raise exception 'grocery item % has no quantity to adjust', p_id;
  end if;

  if v_quantity + p_delta > 0 then
    update public.grocery_items
       set quantity = v_quantity + p_delta
     where id = p_id
    returning * into v_row;
  else
    -- Reaching zero *is* finishing. Out, and on the list, which is the overwhelmingly likely
    -- intent; the row stays on screen in the shopping view to undo by hand.
    update public.grocery_items
       set in_stock           = false,
           needed             = true,
           quantity           = null,
           expires_on         = null,
           expiry_is_estimate = false
     where id = p_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- A real delete, for a typo. The only path that loses history.
create or replace function public.grocery_forget(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.grocery_items where id = p_id;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;
end;
$$;

revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from public;
revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from anon;
revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from authenticated;
grant  execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) to service_role;

revoke execute on function public.grocery_set_needed(uuid, boolean) from public;
revoke execute on function public.grocery_set_needed(uuid, boolean) from anon;
revoke execute on function public.grocery_set_needed(uuid, boolean) from authenticated;
grant  execute on function public.grocery_set_needed(uuid, boolean) to service_role;

revoke execute on function public.grocery_mark_bought(uuid, date, boolean) from public;
revoke execute on function public.grocery_mark_bought(uuid, date, boolean) from anon;
revoke execute on function public.grocery_mark_bought(uuid, date, boolean) from authenticated;
grant  execute on function public.grocery_mark_bought(uuid, date, boolean) to service_role;

revoke execute on function public.grocery_finish(uuid, boolean) from public;
revoke execute on function public.grocery_finish(uuid, boolean) from anon;
revoke execute on function public.grocery_finish(uuid, boolean) from authenticated;
grant  execute on function public.grocery_finish(uuid, boolean) to service_role;

revoke execute on function public.grocery_adjust_quantity(uuid, int) from public;
revoke execute on function public.grocery_adjust_quantity(uuid, int) from anon;
revoke execute on function public.grocery_adjust_quantity(uuid, int) from authenticated;
grant  execute on function public.grocery_adjust_quantity(uuid, int) to service_role;

revoke execute on function public.grocery_forget(uuid) from public;
revoke execute on function public.grocery_forget(uuid) from anon;
revoke execute on function public.grocery_forget(uuid) from authenticated;
grant  execute on function public.grocery_forget(uuid) to service_role;
