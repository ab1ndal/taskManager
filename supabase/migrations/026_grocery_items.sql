-- supabase/migrations/026_grocery_items.sql
--
-- A grocery list shared by every member of a workspace.
--
-- This is the first content table in the schema whose visibility is workspace membership rather
-- than a per-user assignment row: the list is shared property, and every member may read, add,
-- edit and delete any item in it. Tasks are unaffected — they still require task_assignments.
--
-- Two independent booleans rather than one state column, because an item can be owned and wanted
-- at the same time ("we have bananas and need more"). The four reachable combinations are:
--
--   in_stock  needed   meaning
--   --------  ------   -------------------------------------------
--   true      false    have it                     -> pantry view
--   true      true     have it, buy more           -> both views
--   false     true     out, on the list            -> shopping view
--   false     false    archived, history only      -> neither view
--
-- Archived rows are why there is no `check (in_stock or needed)`: "delete" archives, so a product
-- keeps one row forever, autocomplete can rank by times_added, and re-adding resurrects what we
-- already knew instead of opening a second row. public.grocery_forget does a real delete.

create table public.grocery_items (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  name                text not null,
  category            text not null default 'pantry',
  in_stock            boolean not null default true,
  needed              boolean not null default false,
  quantity            int null,
  expires_on          date null,
  expiry_is_estimate  boolean not null default false,
  times_added         int not null default 1,
  added_by_member_id  uuid null references public.workspace_members(id) on delete set null,
  created_at          timestamptz not null default now(),
  state_changed_at    timestamptz not null default now(),

  -- btrim, not length alone: '   ' is not a name, and 'Milk ' must not slip past the unique index
  -- below by hiding behind trailing whitespace. board_columns got this right in migration 015.
  constraint grocery_items_name_len      check (length(btrim(name)) between 1 and 100),
  -- Duplicated in src/app/groceries/categories.ts. The two change together; see docs/db.md.
  constraint grocery_items_category      check (category in ('produce','dairy','frozen','baked',
                                                'pantry','spices','beverages','snacks','household')),
  -- Quantity and expiry describe something you have. An out-of-stock row carries neither, which is
  -- what makes grocery_finish a five-column write rather than a flag flip.
  constraint grocery_items_qty_in_stock  check (in_stock or quantity is null),
  constraint grocery_items_qty_positive  check (quantity is null or quantity > 0),
  constraint grocery_items_expiry_stock  check (in_stock or expires_on is null),
  constraint grocery_items_estimate_date check (not expiry_is_estimate or expires_on is not null),
  -- A fat-fingered year would otherwise pin itself to the top of the expiry sort forever.
  constraint grocery_items_expiry_sane   check (expires_on is null or
                                                expires_on between date '2020-01-01'
                                                              and date '2100-01-01')
);

-- One row per product per workspace, matched case- and whitespace-insensitively. This is also the
-- conflict target public.grocery_upsert relies on, which is why it is an expression index and why
-- the upsert has to live in a function: PostgREST cannot name an expression index in on_conflict.
create unique index grocery_items_workspace_name_key
  on public.grocery_items (workspace_id, lower(btrim(name)));

-- state_changed_at answers "when did this become needed / get bought". A default alone would leave
-- it frozen at creation time, i.e. a column that lies. Only the two lifecycle flags count as a
-- state change; renaming an item or correcting its date does not.
create or replace function private.touch_grocery_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.state_changed_at := now();
  return new;
end;
$$;

create trigger grocery_items_touch_state
  before update on public.grocery_items
  for each row
  when ((old.in_stock, old.needed) is distinct from (new.in_stock, new.needed))
  execute function private.touch_grocery_state();

-- Member ids are workspace-scoped, so nothing else stops a Work member id being stamped on a
-- Household row. Same defect class private.assert_board_column_workspace solves in migration 015.
-- The message wording matches the "is not in workspace" fragment the actions forward to the user.
create or replace function private.assert_grocery_member_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  if new.added_by_member_id is null then
    return new;
  end if;

  select workspace_id into v_workspace
  from public.workspace_members
  where id = new.added_by_member_id;

  if v_workspace is distinct from new.workspace_id then
    raise exception 'member % is not in workspace %', new.added_by_member_id, new.workspace_id;
  end if;

  return new;
end;
$$;

create trigger grocery_items_member_workspace
  before insert or update of added_by_member_id, workspace_id on public.grocery_items
  for each row
  execute function private.assert_grocery_member_workspace();

-- RLS is defence in depth: the server actions use the service-role client and assert membership
-- themselves (tasks/lessons.md L4). `to authenticated` follows migration 007 rather than 015 —
-- 007 revoked `usage on schema private` from anon, so an anon evaluation of the helper would raise
-- 42501 instead of simply returning no rows.
alter table public.grocery_items enable row level security;

create policy "grocery_items_select" on public.grocery_items
  for select to authenticated
  using ( private.is_workspace_member(workspace_id) );

create policy "grocery_items_insert" on public.grocery_items
  for insert to authenticated
  with check ( private.is_workspace_member(workspace_id) );

create policy "grocery_items_update" on public.grocery_items
  for update to authenticated
  using ( private.is_workspace_member(workspace_id) )
  with check ( private.is_workspace_member(workspace_id) );

create policy "grocery_items_delete" on public.grocery_items
  for delete to authenticated
  using ( private.is_workspace_member(workspace_id) );
