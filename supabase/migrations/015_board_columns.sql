-- Kanban board columns, shared per workspace.
--
-- Columns are workspace-scoped rather than per-user so that column names stay consistent across
-- profiles, and a task's column is a single shared value: moving a shared task moves it for every
-- assignee. Per-user priority is unaffected — that stays in task_assignments.member_sort_key.
--
-- Order matters below: the table and its rows must exist before tasks.board_column_id can be
-- backfilled, and the check constraint can only be added once every root task has a column.

create table public.board_columns (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  color        text not null,
  position     numeric not null,
  is_done      boolean not null default false,
  created_at   timestamptz not null default now(),

  constraint board_columns_name_not_blank check (length(btrim(name)) > 0),
  constraint board_columns_name_length check (length(name) <= 40),
  -- Kept in lockstep with TAB20_SLUGS in src/app/board/colors.ts.
  constraint board_columns_color_valid check (color in (
    'tab20-blue','tab20-blue-light','tab20-orange','tab20-orange-light',
    'tab20-green','tab20-green-light','tab20-red','tab20-red-light',
    'tab20-purple','tab20-purple-light','tab20-brown','tab20-brown-light',
    'tab20-pink','tab20-pink-light','tab20-grey','tab20-grey-light',
    'tab20-olive','tab20-olive-light','tab20-cyan','tab20-cyan-light'
  ))
);

-- Case-insensitive, because the all-workspaces board merges columns by lower(name): allowing both
-- "Blocked" and "blocked" in one workspace would make that merge ambiguous.
create unique index board_columns_workspace_name_key
  on public.board_columns (workspace_id, lower(name));

-- At most one terminal column per workspace. Completed tasks render there; two would be undefined.
create unique index board_columns_one_done_per_workspace
  on public.board_columns (workspace_id)
  where is_done;

create index board_columns_workspace_position_idx
  on public.board_columns (workspace_id, position);

alter table public.board_columns enable row level security;

-- private.is_workspace_member is the SECURITY DEFINER helper from migration 007: it does not
-- re-enter RLS, so these policies are non-recursive. Any member may edit the shared columns.
create policy "board_columns_select" on public.board_columns
  for select using ( private.is_workspace_member(workspace_id) );

create policy "board_columns_insert" on public.board_columns
  for insert with check ( private.is_workspace_member(workspace_id) );

create policy "board_columns_update" on public.board_columns
  for update using ( private.is_workspace_member(workspace_id) )
              with check ( private.is_workspace_member(workspace_id) );

create policy "board_columns_delete" on public.board_columns
  for delete using ( private.is_workspace_member(workspace_id) );

-- Seeding lives in a trigger rather than in createWorkspace so that every path into the table —
-- createWorkspace, joinWorkspaceByDirectory, a future import, a manual insert — produces a
-- workspace with columns. A workspace without columns cannot hold a task at all once the check
-- constraint below is in place.
create or replace function private.seed_board_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.board_columns (workspace_id, name, color, position, is_done)
  values
    (new.id, 'Not Started', 'tab20-grey',   1000, false),
    (new.id, 'In Progress', 'tab20-blue',   2000, false),
    (new.id, 'Blocked',     'tab20-red',    3000, false),
    (new.id, 'Follow-up',   'tab20-orange', 4000, false),
    (new.id, 'Completed',   'tab20-green',  5000, true);
  return new;
end;
$$;

create trigger workspaces_seed_board_columns
  after insert on public.workspaces
  for each row execute function private.seed_board_columns();

-- Backfill existing workspaces before touching tasks.
insert into public.board_columns (workspace_id, name, color, position, is_done)
select w.id, d.name, d.color, d.position, d.is_done
from public.workspaces w
cross join (values
  ('Not Started', 'tab20-grey',   1000, false),
  ('In Progress', 'tab20-blue',   2000, false),
  ('Blocked',     'tab20-red',    3000, false),
  ('Follow-up',   'tab20-orange', 4000, false),
  ('Completed',   'tab20-green',  5000, true)
) as d(name, color, position, is_done)
where not exists (
  select 1 from public.board_columns bc where bc.workspace_id = w.id
);

-- restrict, not set null or cascade: a column may only be removed through delete_board_column
-- (migration 016), which reassigns every task first. A silent null would mean a task moved without
-- anyone choosing where.
alter table public.tasks
  add column board_column_id uuid references public.board_columns(id) on delete restrict;

-- Every existing root task goes to its workspace's leftmost non-terminal column.
update public.tasks t
set board_column_id = (
  select bc.id
  from public.board_columns bc
  where bc.workspace_id = t.workspace_id
    and not bc.is_done
  order by bc.position
  limit 1
)
where t.parent_task_id is null;

-- Same shape migration 011 uses for workspace_id: a root task always has a column, a subtask never
-- does. Subtasks carry no workspace, so they have nothing to resolve a column against, and the
-- board only ever renders root tasks.
alter table public.tasks
  add constraint tasks_board_column_matches_root
  check ((parent_task_id is null) = (board_column_id is not null));

create index tasks_board_column_idx on public.tasks (board_column_id);

-- A cross-table condition cannot be a check constraint. Without this, a member of two workspaces
-- could park a Household task in a Work column, and it would vanish from both boards.
create or replace function private.assert_board_column_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column_workspace uuid;
begin
  if new.board_column_id is null then
    return new;
  end if;

  select workspace_id into v_column_workspace
  from public.board_columns
  where id = new.board_column_id;

  if v_column_workspace is null then
    raise exception 'board column % not found', new.board_column_id;
  end if;

  if v_column_workspace is distinct from new.workspace_id then
    raise exception 'board column % belongs to workspace %, not %',
      new.board_column_id, v_column_workspace, new.workspace_id;
  end if;

  return new;
end;
$$;

create trigger tasks_board_column_workspace_matches
  before insert or update of board_column_id, workspace_id on public.tasks
  for each row execute function private.assert_board_column_workspace();
