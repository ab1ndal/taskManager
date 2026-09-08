-- Run inside BEGIN ... ROLLBACK against dev, after migration 030.
-- Assertions raise on failure; no test data is committed.
do $$
declare
  w uuid; i uuid; a uuid; b uuid; c uuid; row public.grocery_items;
  before_lot public.grocery_lots;
begin
  insert into public.workspaces(name, kind) values('E2E grocery SQL', 'household') returning id into w;
  perform set_config('test.grocery_workspace', w::text, true);
  row := public.grocery_upsert(w, 'Milk', 'dairy', 'list'); i := row.id;
  assert not row.in_stock and row.needed, 'shopping add must not create stock';
  assert not exists(select 1 from public.grocery_lots where item_id = i);
  perform public.grocery_mark_bought(i, '2026-09-12', false, 2);
  select id into a from public.grocery_lots where item_id = i;
  perform public.grocery_mark_bought(i, '2026-09-20', false, 3);
  select id into b from public.grocery_lots where item_id = i and id <> a;
  assert (select sum(quantity) = 5 and count(*) = 2 from public.grocery_lots where item_id = i);
  assert (select in_stock and not needed from public.grocery_items where id = i);
  perform public.grocery_adjust_quantity(i, -2);
  assert not exists(select 1 from public.grocery_lots where id = a), 'FEFO removes older stock';
  assert (select quantity = 3 from public.grocery_lots where id = b);
  perform public.grocery_mark_bought(i, '2026-09-20', true, 1);
  assert (select count(*) = 2 from public.grocery_lots where item_id = i), 'matching dates stay separate';
  select id into c from public.grocery_lots where item_id = i and id <> b;
  perform public.grocery_lot_extend(c, '2026-09-20', true);
  assert (select count(*) = 2 from public.grocery_lots where item_id = i), 'date edits never merge purchases';
  perform public.grocery_lot_discard(c, true);
  assert (select in_stock and not needed from public.grocery_items where id = i), 'fresh stock survives discard';
  perform public.grocery_mark_bought(i, null, false, null);
  perform public.grocery_mark_bought(i, null, false, 2);
  assert (select count(*) = 2 from public.grocery_lots where item_id = i and expires_on is null);
  begin
    perform public.grocery_adjust_quantity(i, -1);
    raise exception 'expected unknown-count rejection';
  exception when raise_exception then
    if sqlerrm not like '%has no quantity to adjust%' then raise; end if;
  end;
  assert (select quantity = 3 from public.grocery_lots where id = b), 'rejected decrement is atomic';
  select id into c from public.grocery_lots where item_id = i and quantity is null;
  perform public.grocery_lot_edit(c, 4, '2026-09-10', false);
  perform public.grocery_adjust_quantity(i, -5);
  assert not exists(select 1 from public.grocery_lots where id = c);
  assert (select quantity = 2 from public.grocery_lots where id = b), 'decrement spans multiple lots';
  select * into before_lot from public.grocery_lots where id = b;
  perform public.grocery_lot_extend(b, '2026-10-01', true);
  assert (select quantity = before_lot.quantity and created_at = before_lot.created_at
    from public.grocery_lots where id = b), 'extend preserves count and purchase time';
  begin
    perform public.grocery_lot_edit(b, 0, null, false);
    raise exception 'expected quantity constraint';
  exception when check_violation then null; end;
  begin
    perform public.grocery_lot_edit(b, 1, '2200-01-01', false);
    raise exception 'expected date constraint';
  exception when check_violation then null; end;
  -- Latest purchase can expire sooner; positive corrections must follow purchase time.
  update public.grocery_lots set created_at = '2026-09-01T12:00:00Z' where item_id = i;
  update public.grocery_lots set created_at = '2026-09-07T12:00:00Z', expires_on = '2026-09-08' where id = b;
  perform public.grocery_adjust_quantity(i, 1);
  assert (select quantity = 3 from public.grocery_lots where id = b), 'increment corrects the latest purchase';
  begin
    insert into public.grocery_lots(item_id, expiry_is_estimate) values(i, true);
    raise exception 'expected estimate-date constraint';
  exception when check_violation then null; end;
  perform public.grocery_finish(i, false);
  assert not exists(select 1 from public.grocery_lots where item_id = i);
  assert (select not in_stock and not needed from public.grocery_items where id = i);
  row := public.grocery_upsert(w, ' milk ', null, 'stock', 2, null, false);
  assert row.id = i and row.category = 'dairy' and row.in_stock, 're-add preserves product identity';
  perform public.grocery_adjust_quantity(i, -9);
  assert (select not in_stock and needed from public.grocery_items where id = i), 'zero crossing requests stock';
  perform public.grocery_mark_bought(i, null, false, 1);
  select id into c from public.grocery_lots where item_id = i;
  perform public.grocery_lot_discard(c, true);
  assert (select not in_stock and needed from public.grocery_items where id = i);
  perform public.grocery_mark_bought(i, null, false, 1);
  perform public.grocery_forget(i);
  assert not exists(select 1 from public.grocery_lots where item_id = i), 'forget cascades';
  row := public.grocery_upsert(w, 'Rice', null, 'stock', 2);
  perform set_config('test.grocery_item', row.id::text, true);
  assert not has_function_privilege('authenticated', 'public.grocery_mark_bought(uuid,date,boolean,int)', 'execute');
  assert not has_function_privilege('anon', 'public.grocery_lot_edit(uuid,int,date,boolean)', 'execute');
  assert not has_table_privilege('authenticated', 'public.grocery_lots', 'insert');
  assert not has_table_privilege('authenticated', 'public.grocery_items', 'update');
end;
$$;
-- Real RLS: an authenticated nonmember cannot read this household's batch.
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
    'a member can read batches';
end $$;
reset role;
