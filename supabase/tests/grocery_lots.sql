-- Run inside BEGIN ... ROLLBACK against dev, after migration 031.
-- Assertions raise on failure; no test data is committed.
do $$
declare
  w uuid; i uuid; a uuid; row public.grocery_items;
  before_lot public.grocery_lots;
begin
  insert into public.workspaces(name, kind) values('E2E grocery SQL', 'household') returning id into w;
  perform set_config('test.grocery_workspace', w::text, true);
  row := public.grocery_upsert(w, 'Milk', 'dairy', 'list'); i := row.id;
  assert not row.in_stock and row.needed, 'shopping add must not create stock';
  assert not exists(select 1 from public.grocery_lots where item_id = i);
  perform public.grocery_mark_bought(i, '2026-09-20', false, 2);
  select id into a from public.grocery_lots where item_id = i;
  assert (select in_stock and not needed from public.grocery_items where id = i);
  -- Repurchase merges into the one row: quantities add, the earlier date wins with its flag.
  perform public.grocery_mark_bought(i, '2026-09-12', true, 3);
  assert (select count(*) = 1 from public.grocery_lots where item_id = i), 'purchases merge';
  assert (select id = a and quantity = 5 and expires_on = '2026-09-12' and expiry_is_estimate
    from public.grocery_lots where item_id = i), 'earlier date and its estimate flag win';
  perform public.grocery_mark_bought(i, '2026-09-30', false, 1);
  assert (select quantity = 6 and expires_on = '2026-09-12' and expiry_is_estimate
    from public.grocery_lots where item_id = i), 'later date never replaces earlier';
  perform public.grocery_mark_bought(i, null, false, null);
  assert (select quantity = 7 and expires_on = '2026-09-12'
    from public.grocery_lots where item_id = i), 'no quantity counts as 1; no date keeps the date';
  perform public.grocery_mark_bought(i, '2026-09-12', false, 1);
  assert (select not expiry_is_estimate from public.grocery_lots where item_id = i),
    'on a tie a printed date beats an estimate';
  perform public.grocery_lot_edit(a, 2, null, false);
  perform public.grocery_mark_bought(i, '2026-10-05', true, 1);
  assert (select quantity = 3 and expires_on = '2026-10-05' and expiry_is_estimate
    from public.grocery_lots where item_id = i), 'a date beats no date';
  begin
    insert into public.grocery_lots(item_id, quantity) values(i, 1);
    raise exception 'expected one-row-per-item constraint';
  exception when unique_violation then null; end;
  begin
    perform public.grocery_lot_edit(a, null, null, false);
    raise exception 'expected not-null quantity';
  exception when not_null_violation then null; end;
  perform public.grocery_adjust_quantity(i, 1);
  assert (select quantity = 4 from public.grocery_lots where id = a), 'increment';
  perform public.grocery_adjust_quantity(i, -1);
  assert (select quantity = 3 from public.grocery_lots where id = a), 'decrement';
  select * into before_lot from public.grocery_lots where id = a;
  perform public.grocery_lot_extend(a, '2026-10-01', true);
  assert (select quantity = before_lot.quantity and created_at = before_lot.created_at
    from public.grocery_lots where id = a), 'extend preserves count and purchase time';
  begin
    perform public.grocery_lot_edit(a, 0, null, false);
    raise exception 'expected quantity constraint';
  exception when check_violation then null; end;
  begin
    perform public.grocery_lot_edit(a, 1, '2200-01-01', false);
    raise exception 'expected date constraint';
  exception when check_violation then null; end;
  begin
    update public.grocery_lots set expires_on = null, expiry_is_estimate = true where id = a;
    raise exception 'expected estimate-date constraint';
  exception when check_violation then null; end;
  perform public.grocery_finish(i, false);
  assert not exists(select 1 from public.grocery_lots where item_id = i);
  assert (select not in_stock and not needed from public.grocery_items where id = i);
  row := public.grocery_upsert(w, ' milk ', null, 'stock', 2, null, false);
  assert row.id = i and row.category = 'dairy' and row.in_stock, 're-add preserves product identity';
  row := public.grocery_upsert(w, 'Milk', null, 'stock', null, '2026-09-15', false);
  assert (select quantity = 3 and expires_on = '2026-09-15' from public.grocery_lots where item_id = i),
    'pantry re-add merges like a purchase';
  perform public.grocery_adjust_quantity(i, -9);
  assert (select not in_stock and needed from public.grocery_items where id = i), 'zero crossing requests stock';
  perform public.grocery_mark_bought(i, null, false, 1);
  select id into a from public.grocery_lots where item_id = i;
  perform public.grocery_lot_discard(a, true);
  assert (select not in_stock and needed from public.grocery_items where id = i);
  perform public.grocery_mark_bought(i, null, false, 1);
  perform public.grocery_forget(i);
  assert not exists(select 1 from public.grocery_lots where item_id = i), 'forget cascades';
  row := public.grocery_upsert(w, 'Rice', null, 'stock', 2);
  perform set_config('test.grocery_item', row.id::text, true);
  assert not has_function_privilege('authenticated', 'public.grocery_mark_bought(uuid,date,boolean,int)', 'execute');
  assert not has_function_privilege('anon', 'public.grocery_lot_edit(uuid,int,date,boolean)', 'execute');
  assert not has_function_privilege('authenticated', 'private.grocery_stock_add(uuid,int,date,boolean)', 'execute');
  assert not has_table_privilege('authenticated', 'public.grocery_lots', 'insert');
  assert not has_table_privilege('authenticated', 'public.grocery_items', 'update');
end;
$$;
-- Real RLS: an authenticated nonmember cannot read this household's stock.
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  assert not exists(select 1 from public.grocery_lots where item_id = current_setting('test.grocery_item')::uuid);
end $$;
reset role;
insert into public.workspace_members(workspace_id, auth_user_id, display_name)
values(current_setting('test.grocery_workspace')::uuid,
  (current_setting('request.jwt.claims')::json->>'sub')::uuid, 'SQL test member');
set local role authenticated;
do $$ begin
  assert (select count(*) = 1 from public.grocery_lots where item_id = current_setting('test.grocery_item')::uuid),
    'a member can read stock';
end $$;
reset role;
