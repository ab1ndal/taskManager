-- Since 031 each product has one stock row whose id survives every merge, so a lot id no longer
-- names "the purchase I was looking at". A phone showing "1 expired yogurt" could discard the row
-- after the partner merged a purchase of 4 into it. Every write now bumps a version, and the
-- edit/extend/discard RPCs take the version the caller loaded: a mismatch raises grocery_conflict
-- instead of writing. A null expected version skips the check, which is what the app deployed
-- before this migration sends.
--
-- Quantities are also capped at 999, the limit the forms enforce, because merges and the stepper
-- could otherwise grow a count past anything the edit form can save back.

alter table public.grocery_lots add column version int not null default 1;

create or replace function private.grocery_stock_add(
  p_item uuid, p_quantity int, p_expires_on date, p_estimate boolean
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.grocery_lots as l(item_id, quantity, expires_on, expiry_is_estimate)
  values(p_item, least(coalesce(p_quantity, 1), 999), p_expires_on, p_expires_on is not null and p_estimate)
  on conflict (item_id) do update set
    quantity = least(l.quantity + excluded.quantity, 999),
    expires_on = case
      when excluded.expires_on is null then l.expires_on
      when l.expires_on is null then excluded.expires_on
      else least(l.expires_on, excluded.expires_on)
    end,
    expiry_is_estimate = case
      when excluded.expires_on is null or excluded.expires_on > l.expires_on then l.expiry_is_estimate
      when l.expires_on is null or excluded.expires_on < l.expires_on then excluded.expiry_is_estimate
      else l.expiry_is_estimate and excluded.expiry_is_estimate
    end,
    version = l.version + 1;
end;
$$;

create or replace function public.grocery_adjust_quantity(p_id uuid, p_delta int)
returns public.grocery_items
language plpgsql security definer set search_path = '' as $$
declare v_row public.grocery_items; v_lot public.grocery_lots; v_remaining int;
begin
  perform 1 from public.grocery_items where id = p_id for update;
  if not found then raise exception 'grocery item % not found', p_id; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta::bigint) > 99 then
    raise exception 'invalid quantity adjustment';
  end if;
  if not exists(select 1 from public.grocery_lots where item_id = p_id)
    or exists(select 1 from public.grocery_lots where item_id = p_id and quantity is null) then
    raise exception 'grocery item % has no quantity to adjust', p_id;
  end if;
  if p_delta > 0 then
    -- A correction belongs to the latest purchase, which may have an EARLIER expiry.
    select * into v_lot from public.grocery_lots where item_id = p_id
      order by created_at desc, id desc limit 1;
    update public.grocery_lots set quantity = least(quantity + p_delta, 999), version = version + 1
      where id = v_lot.id;
  else
    v_remaining := -p_delta;
    for v_lot in select * from public.grocery_lots where item_id = p_id
      order by expires_on asc nulls last, created_at asc, id asc
    loop
      if v_remaining >= v_lot.quantity then
        delete from public.grocery_lots where id = v_lot.id;
        v_remaining := v_remaining - v_lot.quantity;
      else
        update public.grocery_lots set quantity = quantity - v_remaining, version = version + 1
          where id = v_lot.id;
        v_remaining := 0;
      end if;
      exit when v_remaining = 0;
    end loop;
    if not exists(select 1 from public.grocery_lots where item_id = p_id) then
      update public.grocery_items set needed = true where id = p_id;
    end if;
  end if;
  select * into v_row from public.grocery_items where id = p_id;
  return v_row;
end;
$$;

-- Changing argument lists needs DROP + CREATE; CREATE OR REPLACE cannot add a parameter. The
-- callers are dropped and recreated below in this same transaction, so nothing runs in between.
-- PostgREST matches .rpc() calls by argument names, and the trailing default lets the old app's
-- calls, which omit p_expected_version, resolve to the new functions.
drop function public.grocery_lot_extend(uuid, date, boolean);
drop function public.grocery_lot_edit(uuid, int, date, boolean);
drop function public.grocery_lot_discard(uuid, boolean);
drop function private.lock_grocery_lot(uuid);

-- Takes the shared parent lock, then checks the lot still exists and, when the caller says which
-- version it saw, that nobody has written it since.
create function private.lock_grocery_lot(p_lot uuid, p_expected_version int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_item uuid; v_version int;
begin
  select item_id into v_item from public.grocery_lots where id = p_lot;
  if not found then raise exception 'grocery lot % not found', p_lot; end if;
  perform 1 from public.grocery_items where id = v_item for update;
  select version into v_version from public.grocery_lots where id = p_lot;
  if not found then raise exception 'grocery lot % not found', p_lot; end if;
  if p_expected_version is not null and p_expected_version <> v_version then
    raise exception 'grocery_conflict: lot % is at version %, caller loaded %',
      p_lot, v_version, p_expected_version;
  end if;
  return v_item;
end;
$$;
revoke all on function private.lock_grocery_lot(uuid, int) from public, anon, authenticated;

create function public.grocery_lot_extend(
  p_lot uuid, p_expires_on date, p_estimate boolean, p_expected_version int default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_grocery_lot(p_lot, p_expected_version);
  update public.grocery_lots set expires_on = p_expires_on,
    expiry_is_estimate = p_expires_on is not null and p_estimate, version = version + 1
    where id = p_lot;
end;
$$;
create function public.grocery_lot_edit(
  p_lot uuid, p_quantity int, p_expires_on date, p_estimate boolean,
  p_expected_version int default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_grocery_lot(p_lot, p_expected_version);
  update public.grocery_lots set quantity = p_quantity, expires_on = p_expires_on,
    expiry_is_estimate = p_expires_on is not null and p_estimate, version = version + 1
    where id = p_lot;
end;
$$;
create function public.grocery_lot_discard(
  p_lot uuid, p_keep_on_list boolean, p_expected_version int default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_item uuid;
begin
  v_item := private.lock_grocery_lot(p_lot, p_expected_version);
  delete from public.grocery_lots where id = p_lot;
  -- Removing stock never clears a shopping intention. Request replenishment only when the row
  -- goes; it stays off the list otherwise unless already needed.
  if p_keep_on_list and not exists(select 1 from public.grocery_lots where item_id = v_item) then
    update public.grocery_items set needed = true where id = v_item;
  end if;
end;
$$;

revoke all on function public.grocery_lot_extend(uuid, date, boolean, int) from public, anon, authenticated;
revoke all on function public.grocery_lot_edit(uuid, int, date, boolean, int) from public, anon, authenticated;
revoke all on function public.grocery_lot_discard(uuid, boolean, int) from public, anon, authenticated;
grant execute on function public.grocery_lot_extend(uuid, date, boolean, int) to service_role;
grant execute on function public.grocery_lot_edit(uuid, int, date, boolean, int) to service_role;
grant execute on function public.grocery_lot_discard(uuid, boolean, int) to service_role;
