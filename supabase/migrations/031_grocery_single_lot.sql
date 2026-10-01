-- One stock row per product. Separate purchase batches made a long pantry harder to read than the
-- per-purchase dates were worth, so each product now has one quantity and one expiry. The table
-- keeps its name so the RLS policy, grants, stock trigger and lot RPCs carry over unchanged.

-- Merge existing batches: the keeper is the earliest-expiring batch (undated last), so the merged
-- row keeps the soonest date and that date's estimate flag. Uncounted batches count as 1, the same
-- default a purchase with no quantity now gets.
with merged as (
  select item_id, sum(coalesce(quantity, 1))::int as quantity,
    (array_agg(id order by expires_on asc nulls last, created_at asc, id asc))[1] as keeper
  from public.grocery_lots
  group by item_id
), kept as (
  update public.grocery_lots l set quantity = merged.quantity
  from merged where l.id = merged.keeper
  returning l.id
)
delete from public.grocery_lots l
using merged where l.item_id = merged.item_id and l.id <> merged.keeper;

alter table public.grocery_lots
  alter column quantity set default 1,
  alter column quantity set not null;
drop index public.grocery_lots_item_id_idx;
alter table public.grocery_lots add constraint grocery_lots_one_per_item unique (item_id);

-- Every purchase path merges through here: quantities add, and the earlier date wins (a date beats
-- no date) carrying its own estimate flag. On a tie a printed date beats an estimate. Callers hold
-- the parent row lock, as with every other stock write.
create function private.grocery_stock_add(
  p_item uuid, p_quantity int, p_expires_on date, p_estimate boolean
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.grocery_lots as l(item_id, quantity, expires_on, expiry_is_estimate)
  values(p_item, coalesce(p_quantity, 1), p_expires_on, p_expires_on is not null and p_estimate)
  on conflict (item_id) do update set
    quantity = l.quantity + excluded.quantity,
    expires_on = case
      when excluded.expires_on is null then l.expires_on
      when l.expires_on is null then excluded.expires_on
      else least(l.expires_on, excluded.expires_on)
    end,
    expiry_is_estimate = case
      when excluded.expires_on is null or excluded.expires_on > l.expires_on then l.expiry_is_estimate
      when l.expires_on is null or excluded.expires_on < l.expires_on then excluded.expiry_is_estimate
      else l.expiry_is_estimate and excluded.expiry_is_estimate
    end;
end;
$$;
revoke all on function private.grocery_stock_add(uuid, int, date, boolean) from public, anon, authenticated;

create or replace function public.grocery_upsert(
  p_workspace uuid, p_name text, p_category text default null, p_target text default null,
  p_quantity int default null, p_expires_on date default null,
  p_estimate boolean default false, p_member uuid default null
) returns public.grocery_items
language plpgsql security definer set search_path = '' as $$
declare v_row public.grocery_items;
begin
  if p_target is null or p_target not in ('stock', 'list') then
    raise exception 'p_target must be stock or list';
  end if;
  insert into public.grocery_items as g(workspace_id, name, category, needed, added_by_member_id)
  values(p_workspace, btrim(p_name), coalesce(p_category, 'pantry'), p_target = 'list', p_member)
  on conflict (workspace_id, lower(btrim(name))) do update
    set category = coalesce(p_category, g.category),
        needed = g.needed or excluded.needed, times_added = g.times_added + 1
  returning * into v_row;
  if p_target = 'stock' then
    perform private.grocery_stock_add(v_row.id, p_quantity, p_expires_on, p_estimate);
  end if;
  select * into v_row from public.grocery_items where id = v_row.id;
  return v_row;
end;
$$;

create or replace function public.grocery_mark_bought(
  p_id uuid, p_expires_on date default null, p_estimate boolean default false,
  p_quantity int default null
) returns public.grocery_items
language plpgsql security definer set search_path = '' as $$
declare v_row public.grocery_items;
begin
  perform 1 from public.grocery_items where id = p_id for update;
  if not found then raise exception 'grocery item % not found', p_id; end if;
  perform private.grocery_stock_add(p_id, p_quantity, p_expires_on, p_estimate);
  update public.grocery_items set needed = false where id = p_id returning * into v_row;
  return v_row;
end;
$$;
