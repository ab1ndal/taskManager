-- Ticking Bought on the shopping list is a claim on that list entry, not a free-standing purchase:
-- two phones tapping it, or a retry after a lost response, must add the stock once. The parent lock
-- serializes the taps, so the second one sees needed = false and adds nothing.
--
-- "Record purchase" on a pantry row reaches the same RPC for an item that is usually not needed,
-- and there every call is a real purchase. So the needed check is opt-in: p_only_if_needed defaults
-- to false, which also keeps the call shape the deployed app sends working unchanged.
--
-- Adding a parameter changes the signature, which CREATE OR REPLACE cannot do, so the old one is
-- dropped and the new one created in this transaction. PostgREST resolves .rpc() by named
-- arguments, and the default lets the old four-argument call match the new function.
drop function public.grocery_mark_bought(uuid, date, boolean, int);
create function public.grocery_mark_bought(
  p_id uuid, p_expires_on date default null, p_estimate boolean default false,
  p_quantity int default null, p_only_if_needed boolean default false
) returns public.grocery_items
language plpgsql security definer set search_path = '' as $$
declare v_row public.grocery_items;
begin
  select * into v_row from public.grocery_items where id = p_id for update;
  if not found then raise exception 'grocery item % not found', p_id; end if;
  if p_only_if_needed and not v_row.needed then
    return v_row;
  end if;
  perform private.grocery_stock_add(p_id, p_quantity, p_expires_on, p_estimate);
  update public.grocery_items set needed = false where id = p_id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.grocery_mark_bought(uuid, date, boolean, int, boolean)
  from public, anon, authenticated;
grant execute on function public.grocery_mark_bought(uuid, date, boolean, int, boolean) to service_role;
