-- Each purchase stays independently editable, even when expiry dates match or are unknown.
create table public.grocery_lots (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.grocery_items(id) on delete cascade,
  quantity int,
  expires_on date,
  expiry_is_estimate boolean not null default false,
  created_at timestamptz not null default now(),
  constraint grocery_lots_qty_positive check (quantity is null or quantity > 0),
  constraint grocery_lots_estimate_date check (not expiry_is_estimate or expires_on is not null),
  constraint grocery_lots_expiry_sane check (expires_on is null or
    expires_on between date '2020-01-01' and date '2100-01-01')
);
create index grocery_lots_item_id_idx on public.grocery_lots(item_id);
alter table public.grocery_lots enable row level security;
create policy grocery_lots_select on public.grocery_lots for select to authenticated
  using (exists (select 1 from public.grocery_items i where i.id = item_id
    and private.is_workspace_member(i.workspace_id)));
-- All stock writes go through serialized, authorized server RPCs. Clients can only read.
revoke all on public.grocery_lots from anon, authenticated;
grant select on public.grocery_lots to authenticated;
grant all on public.grocery_lots to service_role;
revoke insert, update, delete on public.grocery_items from anon, authenticated;

insert into public.grocery_lots(item_id, quantity, expires_on, expiry_is_estimate, created_at)
select id, quantity, expires_on, expiry_is_estimate, created_at
from public.grocery_items where in_stock;

alter table public.grocery_items
  alter column in_stock set default false,
  drop column quantity,
  drop column expires_on,
  drop column expiry_is_estimate;

create or replace function private.sync_grocery_stock() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_item uuid := coalesce(new.item_id, old.item_id);
begin
  update public.grocery_items set in_stock = exists (
    select 1 from public.grocery_lots where item_id = v_item
  ) where id = v_item;
  return null;
end;
$$;
create trigger grocery_lots_sync_stock after insert or delete on public.grocery_lots
for each row execute function private.sync_grocery_stock();

-- Every RPC locks the parent BEFORE touching lots. This also serializes purchases against
-- finishing, discarding and stepping, including when the product currently has no lots.
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
    insert into public.grocery_lots(item_id, quantity, expires_on, expiry_is_estimate)
    values(v_row.id, p_quantity, p_expires_on, p_expires_on is not null and p_estimate);
  end if;
  select * into v_row from public.grocery_items where id = v_row.id;
  return v_row;
end;
$$;

drop function public.grocery_mark_bought(uuid, date, boolean, boolean);
create function public.grocery_mark_bought(
  p_id uuid, p_expires_on date default null, p_estimate boolean default false,
  p_quantity int default null
) returns public.grocery_items
language plpgsql security definer set search_path = '' as $$
declare v_row public.grocery_items;
begin
  perform 1 from public.grocery_items where id = p_id for update;
  if not found then raise exception 'grocery item % not found', p_id; end if;
  insert into public.grocery_lots(item_id, quantity, expires_on, expiry_is_estimate)
  values(p_id, p_quantity, p_expires_on, p_expires_on is not null and p_estimate);
  update public.grocery_items set needed = false where id = p_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.grocery_finish(p_id uuid, p_keep_on_list boolean)
returns public.grocery_items
language plpgsql security definer set search_path = '' as $$
declare v_row public.grocery_items;
begin
  perform 1 from public.grocery_items where id = p_id for update;
  if not found then raise exception 'grocery item % not found', p_id; end if;
  delete from public.grocery_lots where item_id = p_id;
  update public.grocery_items set needed = p_keep_on_list where id = p_id returning * into v_row;
  return v_row;
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
    update public.grocery_lots set quantity = quantity + p_delta where id = v_lot.id;
  else
    v_remaining := -p_delta;
    for v_lot in select * from public.grocery_lots where item_id = p_id
      order by expires_on asc nulls last, created_at asc, id asc
    loop
      if v_remaining >= v_lot.quantity then
        delete from public.grocery_lots where id = v_lot.id;
        v_remaining := v_remaining - v_lot.quantity;
      else
        update public.grocery_lots set quantity = quantity - v_remaining where id = v_lot.id;
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

drop function public.grocery_extend_expiry(uuid, date, boolean);

-- A private helper obtains the shared parent lock, then checks the lot still exists.
create function private.lock_grocery_lot(p_lot uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_item uuid;
begin
  select item_id into v_item from public.grocery_lots where id = p_lot;
  if not found then raise exception 'grocery lot % not found', p_lot; end if;
  perform 1 from public.grocery_items where id = v_item for update;
  if not exists(select 1 from public.grocery_lots where id = p_lot) then
    raise exception 'grocery lot % not found', p_lot;
  end if;
  return v_item;
end;
$$;
revoke all on function private.lock_grocery_lot(uuid) from public, anon, authenticated;

create function public.grocery_lot_extend(p_lot uuid, p_expires_on date, p_estimate boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_grocery_lot(p_lot);
  update public.grocery_lots set expires_on = p_expires_on,
    expiry_is_estimate = p_expires_on is not null and p_estimate where id = p_lot;
end;
$$;
create function public.grocery_lot_edit(p_lot uuid, p_quantity int, p_expires_on date, p_estimate boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_grocery_lot(p_lot);
  update public.grocery_lots set quantity = p_quantity, expires_on = p_expires_on,
    expiry_is_estimate = p_expires_on is not null and p_estimate where id = p_lot;
end;
$$;
create function public.grocery_lot_discard(p_lot uuid, p_keep_on_list boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_item uuid;
begin
  v_item := private.lock_grocery_lot(p_lot);
  delete from public.grocery_lots where id = p_lot;
  -- Removing an old batch never clears a shopping intention. Request replenishment only
  -- when the last batch goes; surviving fresh stock stays off the list unless already needed.
  if p_keep_on_list and not exists(select 1 from public.grocery_lots where item_id = v_item) then
    update public.grocery_items set needed = true where id = v_item;
  end if;
end;
$$;

revoke all on function public.grocery_mark_bought(uuid,date,boolean,int) from public, anon, authenticated;
revoke all on function public.grocery_lot_extend(uuid,date,boolean) from public, anon, authenticated;
revoke all on function public.grocery_lot_edit(uuid,int,date,boolean) from public, anon, authenticated;
revoke all on function public.grocery_lot_discard(uuid,boolean) from public, anon, authenticated;
grant execute on function public.grocery_mark_bought(uuid,date,boolean,int) to service_role;
grant execute on function public.grocery_lot_extend(uuid,date,boolean) to service_role;
grant execute on function public.grocery_lot_edit(uuid,int,date,boolean) to service_role;
grant execute on function public.grocery_lot_discard(uuid,boolean) to service_role;
-- CREATE OR REPLACE preserves the existing service-role-only grants on the other RPCs.
