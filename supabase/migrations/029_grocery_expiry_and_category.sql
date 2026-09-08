-- supabase/migrations/029_grocery_expiry_and_category.sql
--
-- Two silent data-loss defects that only the whole-branch view exposed, plus the narrow write the
-- "Still good" nudge should have had from the start. 026-028 are already applied to dev and
-- recorded in migration history, so this is a new file rather than an edit (tasks/lessons.md L9).
--
-- 1. grocery_upsert set `category = excluded.category` on conflict with no condition, while the
--    add row's category selector sits on an untouched "pantry" default. So typing an existing
--    item's name and pressing Enter — the flow the add row exists for — permanently rewrote that
--    item's category. Category drives the shelf-life estimate on every later add and Bought, and
--    the shopping list's aisle order, so the loss was both invisible and permanent.
--
--    The rule is now "no category supplied means keep what is stored". Note the conflict branch
--    reads p_category directly rather than excluded.category: the insert list has to coalesce to
--    'pantry' to satisfy the NOT NULL for a genuinely new row, which would make excluded.category
--    non-null and defeat the test. p_category is the only expression that still carries the
--    caller's "I did not say".
--
-- 2. grocery_mark_bought executed `expires_on = p_expires_on` unconditionally. markBought computes
--    the category's shelf life, which is null for pantry, spices, beverages, snacks and household
--    — five of the nine categories — so buying more of a low-stock spice erased the date the user
--    had typed in the edit dialog, and for the four perishable categories replaced an asserted
--    printed date with an estimate. The action already distinguishes "omitted, use the shelf life"
--    from "explicitly null, no expiry"; p_set_expiry lets it say so.
--
-- 3. grocery_extend_expiry is new. "Still good" went through a full editItem, whose schema makes
--    name, category and quantity required, so it wrote all three back from props up to 20 seconds
--    stale — reverting the other phone's concurrent rename or count change. That is the
--    lost-update pattern tasks/lessons.md L10 records, and grocery_adjust_quantity's `for update`
--    exists to prevent it. This function names the two expiry columns and nothing else.
--
-- No function below calls current_date: these connections run in UTC, so the caller computes the
-- local date (localToday() in src/app/groceries/categories.ts) and passes it in.

create or replace function public.grocery_upsert(
  p_workspace  uuid,
  p_name       text,
  p_category   text    default null,
  p_target     text    default null,
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
    p_workspace, btrim(p_name), coalesce(p_category, 'pantry'), v_stock, not v_stock,
    case when v_stock then p_quantity end,
    case when v_stock then p_expires_on end,
    case when v_stock and p_expires_on is not null then p_estimate else false end,
    p_member
  )
  on conflict (workspace_id, lower(btrim(name))) do update
    set category           = coalesce(p_category, g.category),
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

-- p_set_expiry adds a parameter, which makes a new function rather than replacing the old one, and
-- a three-argument call would then be ambiguous between the two. The 027 signature is dropped
-- first so exactly one grocery_mark_bought exists.
drop function if exists public.grocery_mark_bought(uuid, date, boolean);

create function public.grocery_mark_bought(
  p_id         uuid,
  p_expires_on date    default null,
  p_estimate   boolean default false,
  p_set_expiry boolean default true
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
         expires_on         = case when p_set_expiry then p_expires_on else expires_on end,
         expiry_is_estimate = case when p_set_expiry
                                   then p_expires_on is not null and p_estimate
                                   else expiry_is_estimate end
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;

  return v_row;
end;
$$;

-- The "Still good" nudge, and nothing else. Two columns, kept in step so a date can never survive
-- with a stale estimate flag.
create or replace function public.grocery_extend_expiry(
  p_id         uuid,
  p_expires_on date,
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
     set expires_on         = p_expires_on,
         expiry_is_estimate = p_expires_on is not null and p_estimate
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;

  return v_row;
end;
$$;

-- create or replace drops a function's grants, and grocery_mark_bought was dropped outright, so
-- every function this migration touches re-issues its own. Model: migration 028.
revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from public;
revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from anon;
revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from authenticated;
grant  execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) to service_role;

revoke execute on function public.grocery_mark_bought(uuid, date, boolean, boolean) from public;
revoke execute on function public.grocery_mark_bought(uuid, date, boolean, boolean) from anon;
revoke execute on function public.grocery_mark_bought(uuid, date, boolean, boolean) from authenticated;
grant  execute on function public.grocery_mark_bought(uuid, date, boolean, boolean) to service_role;

revoke execute on function public.grocery_extend_expiry(uuid, date, boolean) from public;
revoke execute on function public.grocery_extend_expiry(uuid, date, boolean) from anon;
revoke execute on function public.grocery_extend_expiry(uuid, date, boolean) from authenticated;
grant  execute on function public.grocery_extend_expiry(uuid, date, boolean) to service_role;
