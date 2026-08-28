# Kanban Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a kanban board at `/board` where tasks are dragged between shared, per-workspace columns, plus a `/settings` Board tab for defining those columns and their colors.

**Architecture:** Columns live in a new `board_columns` table keyed by `workspace_id` and shared by that workspace's members. A task's column is a single shared value, `tasks.board_column_id`, so a move is a move for everyone; vertical order inside a column stays personal via the existing `task_assignments.member_sort_key`. Any operation spanning two tables (a drop, a column deletion) goes through a `security definer` RPC, following migration 010's pattern.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, Supabase Postgres, `@hello-pangea/dnd` (already a dependency), Zod v4, Jest + Testing Library + jest-axe, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-kanban-board-design.md`

## Global Constraints

- Development order is fixed by `CLAUDE.md`: schema and migrations → RLS → API routes/actions → UI components → tests → polish. Tasks below are ordered accordingly.
- Migrations are append-only and numbered: the next free numbers are `015` and `016`. Never edit an applied migration.
- No local Postgres exists in this environment. Every migration is dry-run against the **dev** Supabase project inside `BEGIN … ROLLBACK` before being applied. Dev and production are separate projects at different migration levels; state which one you touched.
- Server actions are public endpoints. Every action calls `requireUser()` then an authorization assertion from `src/lib/auth.ts`, and parses its input with `parseInput(schema, input)` from `src/app/tasks/schemas.ts`.
- Every action is wrapped in `run("actionName", async () => {...})` from `src/app/tasks/action-run.ts` and returns `ActionResult`. Supabase errors go through `assertNoError("step", result)`.
- Cross-table writes use a `security definer` RPC in the `public` schema with `set search_path = ''`, `revoke execute` from `public`, `anon`, `authenticated`, and `grant execute` to `service_role` only. Called via `createAdminClient()`.
- Colors are stored as tab20 **slugs**, never hex. The 20 allowed slugs are identical in the DB check constraint and the Zod enum.
- Board cards show only: title, deadline, workspace, and a shared indicator. No subtasks, no descriptions, no updates.
- Existing color tokens are addressed as `var(--color-x)` arbitrary values; new tokens are declared in plain `:root` and in the `@media (prefers-color-scheme: dark)` block of `src/app/globals.css`, not in `@theme`.
- Interactive controls keep a `min-h-11` touch target, matching the rest of the app.
- Run `npm run typecheck` before every commit. `npm test` for unit tests, `npm run test:e2e` for Playwright.

## File Structure

**Created:**
- `supabase/migrations/015_board_columns.sql` — table, RLS, seeding trigger, backfill, `tasks.board_column_id`
- `supabase/migrations/016_board_column_rpcs.sql` — `move_task_to_column`, `delete_board_column`
- `src/app/board/colors.ts` — the 20 tab20 slugs, the 5 default columns; no dependencies
- `src/app/board/schemas.ts` — Zod contracts for every board action
- `src/app/board/group-columns.ts` — pure grouping: merge-by-name, task→column bucketing, done-window filter, drop-target resolution
- `src/app/board/actions.ts` — `"use server"`; column CRUD, `listTasksInColumn`, `loadOlderDone`
- `src/app/board/move-actions.ts` — `"use server"`; `moveTaskToColumn` only (kept apart so the drop path stays readable)
- `src/app/board/page.tsx` — server component; fetches columns + root tasks
- `src/app/board/board-client.tsx` — client component; DnD wiring, optimistic moves
- `src/app/board/board-card.tsx` — the thin card
- `src/app/board/loading.tsx`, `src/app/board/error.tsx` — mirror the `/tasks` equivalents
- `src/app/settings/page.tsx` — tabbed shell
- `src/app/settings/profile-tab.tsx` — the current `/profile` body, moved
- `src/app/settings/board-tab.tsx` — server component: loads each workspace's columns
- `src/app/settings/board-columns-editor.tsx` — client component: one workspace's column list plus the add-column form
- `src/app/settings/column-row.tsx` — one editable column row
- `src/app/settings/color-picker.tsx` — the 5×4 tab20 swatch popover
- `src/app/settings/delete-column-dialog.tsx` — per-task destination dialog
- Test files alongside each: `*.test.ts` / `*.test.tsx`
- `e2e/board.spec.ts`

**Modified:**
- `src/app/globals.css` — 20 tab20 tokens, light and dark
- `src/app/tasks/bucket-tasks.ts` — extract `deadlineFor()` so the board reuses the deadline rules instead of restating them
- `src/app/tasks/actions.ts` — `createTaskWithSubtasks` sets `board_column_id`
- `src/app/workspaces/actions.ts` — nothing to change (the DB trigger seeds columns); verify only
- `src/components/nav-links.tsx` — add Board and Settings links
- `src/app/profile/page.tsx` — becomes a redirect to `/settings?tab=profile`
- `src/test/supabase-fake.ts` — teach the fake the two new RPCs
- `docs/db.md`, `docs/product.md` — document the new table and the board view

**Deviation from the spec, and why:** the spec named a single migration `015`. This plan splits the RPCs into `016` so the schema change can be dry-run and reviewed on its own; a broken function definition then can't force a re-cut of the table migration.

**Second deviation:** the spec suggested building the delete dialog on `confirm-dialog.tsx`. That component renders its `body` inside a `<p>`, and the dialog needs a table of selects — invalid HTML inside a paragraph. The plan builds `delete-column-dialog.tsx` directly on `src/components/dialog.tsx` instead, reusing `ConfirmDialog`'s button styling.

---

### Task 1: Schema — `board_columns`, seeding, and `tasks.board_column_id`

**Files:**
- Create: `supabase/migrations/015_board_columns.sql`
- Create: `src/app/board/colors.ts`
- Test: `src/app/board/colors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.board_columns (id uuid, workspace_id uuid, name text, color text, position numeric, is_done boolean, created_at timestamptz)`; column `public.tasks.board_column_id uuid`; trigger function `private.seed_board_columns()`; `TAB20_SLUGS: readonly string[]`, `type Tab20Slug`, `DEFAULT_BOARD_COLUMNS: { name: string; color: Tab20Slug; isDone: boolean }[]` from `src/app/board/colors.ts`.

- [ ] **Step 1: Write the failing test for the color module**

Create `src/app/board/colors.test.ts`:

```ts
import { TAB20_SLUGS, DEFAULT_BOARD_COLUMNS, isTab20Slug } from "./colors";

describe("tab20 palette", () => {
  it("has exactly 20 unique slugs", () => {
    expect(TAB20_SLUGS).toHaveLength(20);
    expect(new Set(TAB20_SLUGS).size).toBe(20);
  });

  it("names every slug in the tab20-<hue> form the CSS tokens use", () => {
    for (const slug of TAB20_SLUGS) {
      expect(slug).toMatch(/^tab20-[a-z]+(-light)?$/);
    }
  });

  it("recognises its own slugs and rejects anything else", () => {
    expect(isTab20Slug("tab20-blue")).toBe(true);
    expect(isTab20Slug("#1f77b4")).toBe(false);
    expect(isTab20Slug("tab20-chartreuse")).toBe(false);
  });

  it("ships the five default columns, exactly one of them terminal", () => {
    expect(DEFAULT_BOARD_COLUMNS.map((c) => c.name)).toEqual([
      "Not Started",
      "In Progress",
      "Blocked",
      "Follow-up",
      "Completed",
    ]);
    expect(DEFAULT_BOARD_COLUMNS.filter((c) => c.isDone)).toHaveLength(1);
    expect(DEFAULT_BOARD_COLUMNS.at(-1)?.isDone).toBe(true);
  });

  it("gives every default column a valid slug", () => {
    for (const column of DEFAULT_BOARD_COLUMNS) {
      expect(isTab20Slug(column.color)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/app/board/colors.test.ts`
Expected: FAIL — `Cannot find module './colors'`.

- [ ] **Step 3: Write the color module**

Create `src/app/board/colors.ts`:

```ts
/**
 * The tab20 palette, as slugs rather than hex.
 *
 * Columns store a slug and the CSS resolves it, so a column's colour follows the light/dark tokens
 * in globals.css instead of being frozen at the value it had when someone picked it. The same list
 * is the check constraint in migration 015 — changing one without the other lets a row exist that
 * the UI cannot paint.
 */
export const TAB20_SLUGS = [
  "tab20-blue",
  "tab20-blue-light",
  "tab20-orange",
  "tab20-orange-light",
  "tab20-green",
  "tab20-green-light",
  "tab20-red",
  "tab20-red-light",
  "tab20-purple",
  "tab20-purple-light",
  "tab20-brown",
  "tab20-brown-light",
  "tab20-pink",
  "tab20-pink-light",
  "tab20-grey",
  "tab20-grey-light",
  "tab20-olive",
  "tab20-olive-light",
  "tab20-cyan",
  "tab20-cyan-light",
] as const;

export type Tab20Slug = (typeof TAB20_SLUGS)[number];

export function isTab20Slug(value: string): value is Tab20Slug {
  return (TAB20_SLUGS as readonly string[]).includes(value);
}

/**
 * Seeded for every workspace by the trigger in migration 015. The terminal column must be last:
 * new tasks land in the leftmost non-terminal column, and the delete dialog defaults to a
 * neighbour, so ordering carries behaviour.
 */
export const DEFAULT_BOARD_COLUMNS: { name: string; color: Tab20Slug; isDone: boolean }[] = [
  { name: "Not Started", color: "tab20-grey", isDone: false },
  { name: "In Progress", color: "tab20-blue", isDone: false },
  { name: "Blocked", color: "tab20-red", isDone: false },
  { name: "Follow-up", color: "tab20-orange", isDone: false },
  { name: "Completed", color: "tab20-green", isDone: true },
];
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx jest src/app/board/colors.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/015_board_columns.sql`:

```sql
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
```

- [ ] **Step 6: Dry-run the migration against dev**

No local Postgres exists here, so this runs against the dev project inside a transaction that is rolled back. Read the connection string from the environment, never paste it into a file:

```bash
psql "$SUPABASE_DEV_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
\i supabase/migrations/015_board_columns.sql
-- Every workspace got five columns, exactly one terminal.
select workspace_id, count(*) as columns, count(*) filter (where is_done) as done
from public.board_columns group by workspace_id;
-- No root task was left without a column, and no subtask acquired one.
select count(*) as root_without_column
from public.tasks where parent_task_id is null and board_column_id is null;
select count(*) as subtask_with_column
from public.tasks where parent_task_id is not null and board_column_id is not null;
rollback;
SQL
```

Expected: every workspace reports `columns = 5, done = 1`; both counts are `0`; the final line is `ROLLBACK`.

- [ ] **Step 7: Verify the two guards actually reject**

```bash
psql "$SUPABASE_DEV_DB_URL" <<'SQL'
begin;
\i supabase/migrations/015_board_columns.sql
-- A second terminal column in one workspace must fail.
insert into public.board_columns (workspace_id, name, color, position, is_done)
select id, 'Done Too', 'tab20-cyan', 6000, true from public.workspaces limit 1;
rollback;
SQL
```

Expected: `ERROR: duplicate key value violates unique constraint "board_columns_one_done_per_workspace"`.

```bash
psql "$SUPABASE_DEV_DB_URL" <<'SQL'
begin;
\i supabase/migrations/015_board_columns.sql
-- A column from another workspace must be refused by the trigger.
update public.tasks
set board_column_id = (
  select bc.id from public.board_columns bc
  where bc.workspace_id <> (select workspace_id from public.tasks where parent_task_id is null limit 1)
  limit 1
)
where id = (select id from public.tasks where parent_task_id is null limit 1);
rollback;
SQL
```

Expected: `ERROR: board column ... belongs to workspace ..., not ...`.

- [ ] **Step 8: Apply the migration to dev**

```bash
psql "$SUPABASE_DEV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/015_board_columns.sql
```

Expected: no errors. Production is a separate project and is not touched by this plan.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/015_board_columns.sql src/app/board/colors.ts src/app/board/colors.test.ts
git commit -m "feat(board): add shared per-workspace board columns

Columns are workspace-scoped and shared by their members, so column
names stay consistent across profiles. tasks.board_column_id is a
single shared value, making a move a move for everyone.

The FK is restrict rather than set null: a column may only be removed
through the reassign-then-delete RPC, so a task can never be relocated
without someone choosing where it goes."
```

---

### Task 2: RPCs — `move_task_to_column` and `delete_board_column`

**Files:**
- Create: `supabase/migrations/016_board_column_rpcs.sql`

**Interfaces:**
- Consumes: `public.board_columns`, `public.tasks.board_column_id` (Task 1).
- Produces: `public.move_task_to_column(p_task_id uuid, p_column_id uuid, p_member_id uuid, p_prev_key numeric, p_next_key numeric) returns void`; `public.delete_board_column(p_column_id uuid, p_moves jsonb) returns void`.

`p_member_id` is on the move function because the drop writes the caller's own `member_sort_key` row; the function verifies that member belongs to the calling user's workspace scope rather than trusting it.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/016_board_column_rpcs.sql`:

```sql
-- Two board operations that span tables, so neither can be a sequence of PostgREST calls.
--
-- Same grant posture as 009/010: public schema for PostgREST exposure, EXECUTE for service_role
-- only, and each function re-checks authorization itself because it is the atomic boundary — the
-- caller's checks happened before this transaction started.

-- A drop writes the shared column on tasks and the caller's own priority key on task_assignments.
-- Half of that is a broken state: the card would appear in the new column for everyone while
-- sitting in the wrong place in the dragger's own list, or vice versa.
create or replace function public.move_task_to_column(
  p_task_id uuid,
  p_column_id uuid,
  p_member_id uuid,
  p_prev_key numeric,
  p_next_key numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_workspace uuid;
  v_parent_task_id uuid;
  v_column_workspace uuid;
  v_member_workspace uuid;
  v_new_key numeric;
begin
  select workspace_id, parent_task_id into v_task_workspace, v_parent_task_id
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'task % not found', p_task_id;
  end if;

  -- The board renders root tasks only, and migration 015's check constraint forbids a column on a
  -- subtask, so this would fail downstream anyway. Failing here names the actual problem.
  if v_parent_task_id is not null then
    raise exception 'task % is a subtask and has no board column', p_task_id;
  end if;

  select workspace_id into v_column_workspace
  from public.board_columns
  where id = p_column_id;

  if v_column_workspace is null then
    raise exception 'board column % not found', p_column_id;
  end if;

  if v_column_workspace is distinct from v_task_workspace then
    raise exception 'board column % is not in workspace %', p_column_id, v_task_workspace;
  end if;

  -- member_sort_key is per-user priority: the caller may only reorder their own list. The action
  -- checks this too, but membership could have changed since.
  select workspace_id into v_member_workspace
  from public.workspace_members
  where id = p_member_id;

  if v_member_workspace is distinct from v_task_workspace then
    raise exception 'member % is not in workspace %', p_member_id, v_task_workspace;
  end if;

  update public.tasks
  set board_column_id = p_column_id
  where id = p_task_id;

  -- Same key arithmetic as reorderTask in src/app/tasks/actions.ts: midpoint between neighbours,
  -- or a full step beyond the one neighbour that exists. Both null means the destination column is
  -- empty, so the existing key stands and only the column changes.
  if p_prev_key is null and p_next_key is null then
    return;
  elsif p_prev_key is null then
    v_new_key := p_next_key - 1000;
  elsif p_next_key is null then
    v_new_key := p_prev_key + 1000;
  else
    v_new_key := (p_prev_key + p_next_key) / 2;
  end if;

  update public.task_assignments
  set member_sort_key = v_new_key
  where task_id = p_task_id
    and member_id = p_member_id;

  if not found then
    raise exception 'member % is not assigned to task %', p_member_id, p_task_id;
  end if;
end;
$$;

revoke execute on function public.move_task_to_column(uuid, uuid, uuid, numeric, numeric) from public;
revoke execute on function public.move_task_to_column(uuid, uuid, uuid, numeric, numeric) from anon;
revoke execute on function public.move_task_to_column(uuid, uuid, uuid, numeric, numeric) from authenticated;
grant execute on function public.move_task_to_column(uuid, uuid, uuid, numeric, numeric) to service_role;

-- Deleting a column reassigns its tasks and then drops the row. p_moves is
-- [{"task_id": uuid, "target_column_id": uuid}, ...] — one entry per task, because the user picks a
-- destination for each task individually rather than one destination for the column.
create or replace function public.delete_board_column(
  p_column_id uuid,
  p_moves jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_remaining int;
  v_actual uuid[];
  v_requested uuid[];
begin
  select workspace_id into v_workspace_id
  from public.board_columns
  where id = p_column_id
  for update;

  if not found then
    raise exception 'board column % not found', p_column_id;
  end if;

  -- A workspace with no columns cannot hold a task: migration 015 requires every root task to have
  -- one, so an empty workspace would reject its next insert.
  select count(*) into v_remaining
  from public.board_columns
  where workspace_id = v_workspace_id
    and id <> p_column_id;

  if v_remaining = 0 then
    raise exception 'cannot delete the last column of workspace %', v_workspace_id;
  end if;

  if jsonb_typeof(p_moves) is distinct from 'array' then
    raise exception 'p_moves must be a json array';
  end if;

  -- Coverage check: p_moves must name exactly the tasks currently in the column. The dialog listed
  -- what it read a moment ago; if someone else added a task to this column or moved one out since,
  -- deleting now would relocate a task nobody chose a destination for. Refuse instead.
  select coalesce(array_agg(id order by id), '{}') into v_actual
  from public.tasks
  where board_column_id = p_column_id;

  select coalesce(array_agg(task_id order by task_id), '{}') into v_requested
  from jsonb_to_recordset(p_moves) as m(task_id uuid, target_column_id uuid);

  if v_actual is distinct from v_requested then
    raise exception 'column % changed since it was listed', p_column_id
      using errcode = 'serialization_failure';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_moves) as m(task_id uuid, target_column_id uuid)
    where m.target_column_id = p_column_id
       or not exists (
         select 1 from public.board_columns bc
         where bc.id = m.target_column_id
           and bc.workspace_id = v_workspace_id
       )
  ) then
    raise exception 'every destination must be a different column in workspace %', v_workspace_id;
  end if;

  update public.tasks t
  set board_column_id = m.target_column_id
  from jsonb_to_recordset(p_moves) as m(task_id uuid, target_column_id uuid)
  where t.id = m.task_id;

  delete from public.board_columns where id = p_column_id;
end;
$$;

revoke execute on function public.delete_board_column(uuid, jsonb) from public;
revoke execute on function public.delete_board_column(uuid, jsonb) from anon;
revoke execute on function public.delete_board_column(uuid, jsonb) from authenticated;
grant execute on function public.delete_board_column(uuid, jsonb) to service_role;
```

- [ ] **Step 2: Dry-run and exercise both functions against dev**

```bash
psql "$SUPABASE_DEV_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
\i supabase/migrations/016_board_column_rpcs.sql

-- A move into a column of another workspace must be refused.
do $$
declare
  v_task uuid;
  v_foreign_column uuid;
  v_member uuid;
begin
  select id into v_task from public.tasks where parent_task_id is null limit 1;
  select bc.id into v_foreign_column
  from public.board_columns bc
  where bc.workspace_id <> (select workspace_id from public.tasks where id = v_task);
  select member_id into v_member from public.task_assignments where task_id = v_task limit 1;

  if v_foreign_column is null then
    raise notice 'only one workspace in dev; foreign-column case not exercised';
  else
    begin
      perform public.move_task_to_column(v_task, v_foreign_column, v_member, null, null);
      raise exception 'expected a rejection but the move succeeded';
    exception when others then
      raise notice 'refused as expected: %', sqlerrm;
    end;
  end if;
end $$;

-- A delete whose moves do not cover the column's tasks must be refused.
do $$
declare
  v_column uuid;
begin
  select board_column_id into v_column
  from public.tasks
  where board_column_id is not null
  limit 1;

  begin
    perform public.delete_board_column(v_column, '[]'::jsonb);
    raise exception 'expected a rejection but the delete succeeded';
  exception when others then
    raise notice 'refused as expected: %', sqlerrm;
  end;
end $$;

rollback;
SQL
```

Expected: two `NOTICE: refused as expected: ...` lines, then `ROLLBACK`. If dev has only one workspace the first case prints its skip notice instead — that path is covered by the unit tests in Task 4.

- [ ] **Step 3: Apply to dev**

```bash
psql "$SUPABASE_DEV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/016_board_column_rpcs.sql
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/016_board_column_rpcs.sql
git commit -m "feat(board): add move and delete RPCs for board columns

A drop writes the shared column on tasks and the dragger's own sort key
on task_assignments; a column delete reassigns tasks and then drops the
row. Neither is safe as separate PostgREST calls, so both live in one
transaction.

delete_board_column asserts its moves cover exactly the tasks currently
in the column. That is the concurrency guard: if the column changed
since the dialog listed it, the delete is refused rather than relocating
a task nobody chose a destination for."
```

---

### Task 3: Teach the test fake the new RPCs

**Files:**
- Modify: `src/test/supabase-fake.ts:200-285` (inside the `rpc` handler, before the `unknown rpc` fallback)
- Test: `src/test/supabase-fake.test.ts`

**Interfaces:**
- Consumes: the RPC signatures from Task 2.
- Produces: `rpc("move_task_to_column", { p_task_id, p_column_id, p_member_id, p_prev_key, p_next_key })` and `rpc("delete_board_column", { p_column_id, p_moves })` answering from the in-memory `tables`, so every action test in Tasks 4–6 asserts on resulting state rather than on call order.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/supabase-fake.test.ts`:

```ts
describe("move_task_to_column", () => {
  const WS = "a0000000-0000-4000-8000-000000000001";
  const COL_A = "e0000000-0000-4000-8000-00000000000a";
  const COL_B = "e0000000-0000-4000-8000-00000000000b";
  const MEMBER = "b0000000-0000-4000-8000-000000000001";
  const TASK = "c0000000-0000-4000-8000-000000000001";

  function tables() {
    return {
      workspace_members: [{ id: MEMBER, workspace_id: WS, auth_user_id: "auth-user-1" }],
      board_columns: [
        { id: COL_A, workspace_id: WS, name: "Not Started", position: 1000, is_done: false },
        { id: COL_B, workspace_id: WS, name: "In Progress", position: 2000, is_done: false },
      ],
      tasks: [{ id: TASK, workspace_id: WS, parent_task_id: null, board_column_id: COL_A }],
      task_assignments: [{ task_id: TASK, member_id: MEMBER, member_sort_key: 1000 }],
    };
  }

  it("writes the column and the midpoint sort key together", async () => {
    const t = tables();
    const fake = createFakeSupabase({ tables: t });

    const { error } = await fake.rpc("move_task_to_column", {
      p_task_id: TASK,
      p_column_id: COL_B,
      p_member_id: MEMBER,
      p_prev_key: 1000,
      p_next_key: 2000,
    });

    expect(error).toBeNull();
    expect((t.tasks as Row[])[0].board_column_id).toBe(COL_B);
    expect((t.task_assignments as Row[])[0].member_sort_key).toBe(1500);
  });

  it("changes only the column when the destination is empty", async () => {
    const t = tables();
    const fake = createFakeSupabase({ tables: t });

    await fake.rpc("move_task_to_column", {
      p_task_id: TASK,
      p_column_id: COL_B,
      p_member_id: MEMBER,
      p_prev_key: null,
      p_next_key: null,
    });

    expect((t.tasks as Row[])[0].board_column_id).toBe(COL_B);
    expect((t.task_assignments as Row[])[0].member_sort_key).toBe(1000);
  });

  it("refuses a column from another workspace", async () => {
    const t = tables();
    (t.board_columns as Row[]).push({
      id: "e0000000-0000-4000-8000-00000000000c",
      workspace_id: "a0000000-0000-4000-8000-000000000002",
      name: "Elsewhere",
      position: 1000,
      is_done: false,
    });
    const fake = createFakeSupabase({ tables: t });

    const { error } = await fake.rpc("move_task_to_column", {
      p_task_id: TASK,
      p_column_id: "e0000000-0000-4000-8000-00000000000c",
      p_member_id: MEMBER,
      p_prev_key: null,
      p_next_key: null,
    });

    expect(error?.message).toMatch(/not in workspace/);
    expect((t.tasks as Row[])[0].board_column_id).toBe(COL_A);
  });
});

describe("delete_board_column", () => {
  const WS = "a0000000-0000-4000-8000-000000000001";
  const COL_A = "e0000000-0000-4000-8000-00000000000a";
  const COL_B = "e0000000-0000-4000-8000-00000000000b";
  const T1 = "c0000000-0000-4000-8000-000000000001";
  const T2 = "c0000000-0000-4000-8000-000000000002";

  function tables() {
    return {
      board_columns: [
        { id: COL_A, workspace_id: WS, name: "Blocked", position: 1000, is_done: false },
        { id: COL_B, workspace_id: WS, name: "In Progress", position: 2000, is_done: false },
      ],
      tasks: [
        { id: T1, workspace_id: WS, parent_task_id: null, board_column_id: COL_A },
        { id: T2, workspace_id: WS, parent_task_id: null, board_column_id: COL_A },
      ],
    };
  }

  it("applies each task's own destination and drops the column", async () => {
    const t = tables();
    const fake = createFakeSupabase({ tables: t });

    const { error } = await fake.rpc("delete_board_column", {
      p_column_id: COL_A,
      p_moves: [
        { task_id: T1, target_column_id: COL_B },
        { task_id: T2, target_column_id: COL_B },
      ],
    });

    expect(error).toBeNull();
    expect((t.tasks as Row[]).map((r) => r.board_column_id)).toEqual([COL_B, COL_B]);
    expect((t.board_columns as Row[]).map((r) => r.id)).toEqual([COL_B]);
  });

  it("refuses moves that do not cover every task in the column", async () => {
    const t = tables();
    const fake = createFakeSupabase({ tables: t });

    const { error } = await fake.rpc("delete_board_column", {
      p_column_id: COL_A,
      p_moves: [{ task_id: T1, target_column_id: COL_B }],
    });

    expect(error?.message).toMatch(/changed since it was listed/);
    expect((t.board_columns as Row[])).toHaveLength(2);
    expect((t.tasks as Row[])[0].board_column_id).toBe(COL_A);
  });

  it("refuses deleting the workspace's last column", async () => {
    const t = tables();
    t.board_columns = [(t.board_columns as Row[])[0]];
    (t.tasks as Row[]).forEach((task) => (task.board_column_id = COL_A));
    const fake = createFakeSupabase({ tables: t });

    const { error } = await fake.rpc("delete_board_column", {
      p_column_id: COL_A,
      p_moves: [
        { task_id: T1, target_column_id: COL_A },
        { task_id: T2, target_column_id: COL_A },
      ],
    });

    expect(error?.message).toMatch(/last column/);
    expect((t.board_columns as Row[])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/test/supabase-fake.test.ts -t "move_task_to_column"`
Expected: FAIL — `unknown rpc: move_task_to_column`.

- [ ] **Step 3: Implement both handlers in the fake**

In `src/test/supabase-fake.ts`, insert before the `return { data: null, error: { message: \`unknown rpc: ${fnName}\` } };` line:

```ts
      // Mirrors migration 016: the shared column on tasks and the caller's own sort key move
      // together, with the same key arithmetic reorderTask uses.
      if (fnName === "move_task_to_column") {
        const taskId = params.p_task_id as string;
        const columnId = params.p_column_id as string;
        const memberId = params.p_member_id as string;
        const prevKey = params.p_prev_key as number | null;
        const nextKey = params.p_next_key as number | null;

        const task = ((tables.tasks ?? []) as Row[]).find((t) => t.id === taskId);
        if (!task) return { data: null, error: { message: `task ${taskId} not found` } };
        if (task.parent_task_id) {
          return { data: null, error: { message: `task ${taskId} is a subtask` } };
        }

        const column = ((tables.board_columns ?? []) as Row[]).find((c) => c.id === columnId);
        if (!column) return { data: null, error: { message: `board column ${columnId} not found` } };
        if (column.workspace_id !== task.workspace_id) {
          return {
            data: null,
            error: { message: `board column ${columnId} is not in workspace ${task.workspace_id}` },
          };
        }

        const member = ((tables.workspace_members ?? []) as Row[]).find((m) => m.id === memberId);
        if (!member || member.workspace_id !== task.workspace_id) {
          return {
            data: null,
            error: { message: `member ${memberId} is not in workspace ${task.workspace_id}` },
          };
        }

        task.board_column_id = columnId;

        if (prevKey === null && nextKey === null) return { data: null, error: null };

        const assignment = ((tables.task_assignments ?? []) as Row[]).find(
          (a) => a.task_id === taskId && a.member_id === memberId
        );
        if (!assignment) {
          return {
            data: null,
            error: { message: `member ${memberId} is not assigned to task ${taskId}` },
          };
        }

        assignment.member_sort_key =
          prevKey === null ? nextKey! - 1000 : nextKey === null ? prevKey + 1000 : (prevKey + nextKey) / 2;

        return { data: null, error: null };
      }

      // Mirrors migration 016: p_moves must name exactly the tasks currently in the column, so a
      // stale dialog is refused rather than relocating a task nobody chose a destination for.
      if (fnName === "delete_board_column") {
        const columnId = params.p_column_id as string;
        const moves = (params.p_moves ?? []) as { task_id: string; target_column_id: string }[];
        const columns = (tables.board_columns ?? []) as Row[];
        const column = columns.find((c) => c.id === columnId);

        if (!column) return { data: null, error: { message: `board column ${columnId} not found` } };

        const siblings = columns.filter(
          (c) => c.workspace_id === column.workspace_id && c.id !== columnId
        );
        if (siblings.length === 0) {
          return {
            data: null,
            error: { message: `cannot delete the last column of workspace ${column.workspace_id}` },
          };
        }

        const taskRows = (tables.tasks ?? []) as Row[];
        const actual = taskRows
          .filter((t) => t.board_column_id === columnId)
          .map((t) => t.id as string)
          .sort();
        const requested = moves.map((m) => m.task_id).sort();

        if (actual.join() !== requested.join()) {
          return {
            data: null,
            error: { message: `column ${columnId} changed since it was listed` },
          };
        }

        const badTarget = moves.some(
          (m) =>
            m.target_column_id === columnId ||
            !siblings.some((c) => c.id === m.target_column_id)
        );
        if (badTarget) {
          return {
            data: null,
            error: {
              message: `every destination must be a different column in workspace ${column.workspace_id}`,
            },
          };
        }

        for (const move of moves) {
          const task = taskRows.find((t) => t.id === move.task_id);
          if (task) task.board_column_id = move.target_column_id;
        }

        tables.board_columns = columns.filter((c) => c.id !== columnId);

        return { data: null, error: null };
      }
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx jest src/test/supabase-fake.test.ts`
Expected: PASS, including the six new tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/test/supabase-fake.ts src/test/supabase-fake.test.ts
git commit -m "test(board): teach the supabase fake the board column RPCs

The fake answers by table and filter so action tests assert on resulting
state rather than call order; both new RPCs follow that, including the
coverage check that makes a stale delete dialog fail."
```

---

### Task 4: Zod contracts and the tab20 CSS tokens

**Files:**
- Create: `src/app/board/schemas.ts`
- Test: `src/app/board/schemas.test.ts`
- Modify: `src/app/globals.css` (plain `:root` block and the `@media (prefers-color-scheme: dark)` block)

**Interfaces:**
- Consumes: `TAB20_SLUGS`, `Tab20Slug` (Task 1); `ValidationError`, `parseInput` from `src/app/tasks/schemas.ts`.
- Produces: `createBoardColumnSchema`, `renameBoardColumnSchema`, `setBoardColumnColorSchema`, `reorderBoardColumnSchema`, `deleteBoardColumnSchema`, `moveTaskToColumnSchema`, `listTasksInColumnSchema`, `loadOlderDoneSchema`, and the matching `z.input` types: `CreateBoardColumnInput`, `RenameBoardColumnInput`, `SetBoardColumnColorInput`, `ReorderBoardColumnInput`, `DeleteBoardColumnInput`, `MoveTaskToColumnInput`, `ListTasksInColumnInput`, `LoadOlderDoneInput`. CSS custom properties `--color-tab20-*` for all 20 slugs.

- [ ] **Step 1: Write the failing tests**

Create `src/app/board/schemas.test.ts`:

```ts
import { parseInput, ValidationError } from "@/app/tasks/schemas";
import {
  createBoardColumnSchema,
  deleteBoardColumnSchema,
  moveTaskToColumnSchema,
  renameBoardColumnSchema,
  setBoardColumnColorSchema,
} from "./schemas";

const WS = "a0000000-0000-4000-8000-000000000001";
const COL = "e0000000-0000-4000-8000-00000000000a";
const COL_B = "e0000000-0000-4000-8000-00000000000b";
const TASK = "c0000000-0000-4000-8000-000000000001";
const MEMBER = "b0000000-0000-4000-8000-000000000001";

describe("createBoardColumnSchema", () => {
  it("accepts a trimmed name and a tab20 slug", () => {
    expect(
      parseInput(createBoardColumnSchema, { workspaceId: WS, name: "  Waiting  ", color: "tab20-cyan" })
    ).toEqual({ workspaceId: WS, name: "Waiting", color: "tab20-cyan" });
  });

  it("rejects a blank name", () => {
    expect(() =>
      parseInput(createBoardColumnSchema, { workspaceId: WS, name: "   ", color: "tab20-cyan" })
    ).toThrow(ValidationError);
  });

  it("rejects a name over 40 characters, matching the database constraint", () => {
    expect(() =>
      parseInput(createBoardColumnSchema, { workspaceId: WS, name: "x".repeat(41), color: "tab20-cyan" })
    ).toThrow(/40 characters/);
  });

  it("rejects a hex colour", () => {
    expect(() =>
      parseInput(createBoardColumnSchema, { workspaceId: WS, name: "Waiting", color: "#1f77b4" })
    ).toThrow(ValidationError);
  });
});

describe("renameBoardColumnSchema", () => {
  it("keeps the id and the trimmed name", () => {
    expect(parseInput(renameBoardColumnSchema, { columnId: COL, name: " Parked " })).toEqual({
      columnId: COL,
      name: "Parked",
    });
  });
});

describe("setBoardColumnColorSchema", () => {
  it("rejects a slug that is not in the palette", () => {
    expect(() =>
      parseInput(setBoardColumnColorSchema, { columnId: COL, color: "tab20-chartreuse" })
    ).toThrow(ValidationError);
  });
});

describe("moveTaskToColumnSchema", () => {
  it("accepts null neighbour keys, which mean an empty destination", () => {
    expect(
      parseInput(moveTaskToColumnSchema, {
        taskId: TASK,
        columnId: COL,
        memberId: MEMBER,
        prevKey: null,
        nextKey: null,
      })
    ).toEqual({ taskId: TASK, columnId: COL, memberId: MEMBER, prevKey: null, nextKey: null });
  });

  it("rejects a non-numeric neighbour key", () => {
    expect(() =>
      parseInput(moveTaskToColumnSchema, {
        taskId: TASK,
        columnId: COL,
        memberId: MEMBER,
        prevKey: "1000",
        nextKey: null,
      })
    ).toThrow(ValidationError);
  });
});

describe("deleteBoardColumnSchema", () => {
  it("accepts an empty moves array, which means an empty column", () => {
    expect(parseInput(deleteBoardColumnSchema, { columnId: COL, moves: [] })).toEqual({
      columnId: COL,
      moves: [],
    });
  });

  it("accepts one destination per task", () => {
    const input = { columnId: COL, moves: [{ taskId: TASK, targetColumnId: COL_B }] };
    expect(parseInput(deleteBoardColumnSchema, input)).toEqual(input);
  });

  it("rejects a move whose destination is the column being deleted", () => {
    expect(() =>
      parseInput(deleteBoardColumnSchema, { columnId: COL, moves: [{ taskId: TASK, targetColumnId: COL }] })
    ).toThrow(/different column/);
  });

  it("rejects the same task twice", () => {
    expect(() =>
      parseInput(deleteBoardColumnSchema, {
        columnId: COL,
        moves: [
          { taskId: TASK, targetColumnId: COL_B },
          { taskId: TASK, targetColumnId: COL_B },
        ],
      })
    ).toThrow(/once/);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/app/board/schemas.test.ts`
Expected: FAIL — `Cannot find module './schemas'`.

- [ ] **Step 3: Write the schemas**

Create `src/app/board/schemas.ts`:

```ts
import { z } from "zod";

import { TAB20_SLUGS } from "./colors";

/**
 * Input contracts for the board server actions.
 *
 * Same posture as src/app/tasks/schemas.ts: actions are public endpoints, so these schemas are the
 * boundary and the client imports the same ones. Limits mirror migration 015 exactly — a name the
 * schema accepts and the database rejects would surface as a generic error instead of a field one.
 */

const uuid = z.uuid("Expected a UUID");

const columnName = z
  .string()
  .trim()
  .min(1, "Column name is required")
  .max(40, "Column name must be 40 characters or fewer");

const color = z.enum(TAB20_SLUGS, { message: "Choose one of the 20 palette colours" });

/** A neighbour's member_sort_key, or null when the card lands at an end of the column. */
const neighbourKey = z.number().nullable();

export const createBoardColumnSchema = z.object({
  workspaceId: uuid,
  name: columnName,
  color,
});

export const renameBoardColumnSchema = z.object({
  columnId: uuid,
  name: columnName,
});

export const setBoardColumnColorSchema = z.object({
  columnId: uuid,
  color,
});

export const reorderBoardColumnSchema = z.object({
  columnId: uuid,
  prevPosition: neighbourKey,
  nextPosition: neighbourKey,
});

export const moveTaskToColumnSchema = z.object({
  taskId: uuid,
  columnId: uuid,
  memberId: uuid,
  prevKey: neighbourKey,
  nextKey: neighbourKey,
});

export const listTasksInColumnSchema = z.object({ columnId: uuid });

export const loadOlderDoneSchema = z.object({
  workspaceIds: z.array(uuid).min(1, "Name at least one workspace").max(20),
  /** The oldest completed_at already on screen; the next page is strictly older than this. */
  before: z.iso.datetime("Expected an ISO timestamp"),
});

/**
 * One destination per task, because the user chooses individually. `moves` must be empty exactly
 * when the column is empty — the action checks that against the database, since only the database
 * knows what is in the column right now.
 */
export const deleteBoardColumnSchema = z
  .object({
    columnId: uuid,
    moves: z
      .array(z.object({ taskId: uuid, targetColumnId: uuid }))
      .max(500, "Too many tasks to move in one deletion"),
  })
  .refine((value) => value.moves.every((m) => m.targetColumnId !== value.columnId), {
    message: "Each task must move to a different column",
    path: ["moves"],
  })
  .refine((value) => new Set(value.moves.map((m) => m.taskId)).size === value.moves.length, {
    message: "Each task may appear only once",
    path: ["moves"],
  });

export type CreateBoardColumnInput = z.input<typeof createBoardColumnSchema>;
export type RenameBoardColumnInput = z.input<typeof renameBoardColumnSchema>;
export type SetBoardColumnColorInput = z.input<typeof setBoardColumnColorSchema>;
export type ReorderBoardColumnInput = z.input<typeof reorderBoardColumnSchema>;
export type MoveTaskToColumnInput = z.input<typeof moveTaskToColumnSchema>;
export type ListTasksInColumnInput = z.input<typeof listTasksInColumnSchema>;
export type LoadOlderDoneInput = z.input<typeof loadOlderDoneSchema>;
export type DeleteBoardColumnInput = z.input<typeof deleteBoardColumnSchema>;
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx jest src/app/board/schemas.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Add the tab20 tokens to `globals.css`**

In the plain `:root` block, after the `--color-kind-*` tokens, add:

```css
  /*
   * tab20, the palette board columns choose from. Stored as slugs on board_columns.color, so these
   * token names are part of the contract — see TAB20_SLUGS in src/app/board/colors.ts.
   *
   * One token per colour, not three: the column header tint and the card rail are both derived with
   * color-mix() at the point of use, which keeps the dark-mode block below to twenty lines instead
   * of sixty and guarantees tint and rail can never disagree.
   */
  --color-tab20-blue: #1f77b4;
  --color-tab20-blue-light: #6baed6;
  --color-tab20-orange: #d95f02;
  --color-tab20-orange-light: #fdae6b;
  --color-tab20-green: #2c8c2c;
  --color-tab20-green-light: #74c476;
  --color-tab20-red: #c62828;
  --color-tab20-red-light: #ef8a8a;
  --color-tab20-purple: #7c5cbf;
  --color-tab20-purple-light: #b39ddb;
  --color-tab20-brown: #8c564b;
  --color-tab20-brown-light: #c49c94;
  --color-tab20-pink: #c2185b;
  --color-tab20-pink-light: #f48fb1;
  --color-tab20-grey: #6b6878;
  --color-tab20-grey-light: #b0aec2;
  --color-tab20-olive: #827717;
  --color-tab20-olive-light: #c5c76a;
  --color-tab20-cyan: #00838f;
  --color-tab20-cyan-light: #6fc7d1;
```

In the `@media (prefers-color-scheme: dark)` block, redefine all twenty. Dark surfaces need the
lighter end of each pair to stay legible, so each token moves up in lightness rather than keeping
its light-theme value:

```css
    --color-tab20-blue: #6baed6;
    --color-tab20-blue-light: #9ecae1;
    --color-tab20-orange: #fdae6b;
    --color-tab20-orange-light: #fdd0a2;
    --color-tab20-green: #74c476;
    --color-tab20-green-light: #a1d99b;
    --color-tab20-red: #ef8a8a;
    --color-tab20-red-light: #f7b6b6;
    --color-tab20-purple: #b39ddb;
    --color-tab20-purple-light: #d1c4e9;
    --color-tab20-brown: #c49c94;
    --color-tab20-brown-light: #ddc0b9;
    --color-tab20-pink: #f48fb1;
    --color-tab20-pink-light: #f8bbd0;
    --color-tab20-grey: #b0aec2;
    --color-tab20-grey-light: #cfcdd9;
    --color-tab20-olive: #c5c76a;
    --color-tab20-olive-light: #dcdda0;
    --color-tab20-cyan: #6fc7d1;
    --color-tab20-cyan-light: #a5dde3;
```

- [ ] **Step 6: Verify every slug has a token in both themes**

The contract between the slug list and the CSS is easy to break silently, so assert it. Append to `src/app/board/colors.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("tab20 CSS tokens", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const darkBlock = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));

  it.each(TAB20_SLUGS)("declares --color-%s in the light theme", (slug) => {
    expect(css).toContain(`--color-${slug}:`);
  });

  it.each(TAB20_SLUGS)("redeclares --color-%s in the dark theme", (slug) => {
    expect(darkBlock).toContain(`--color-${slug}:`);
  });
});
```

Run: `npx jest src/app/board/colors.test.ts`
Expected: PASS, 45 tests. A missing token fails with the slug named.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/app/board/schemas.ts src/app/board/schemas.test.ts src/app/board/colors.test.ts src/app/globals.css
git commit -m "feat(board): add board action schemas and the tab20 tokens

Limits mirror migration 015 so a value the schema accepts is never
rejected by the database as a generic error. One CSS token per colour,
with the header tint derived at the point of use, so tint and rail
cannot disagree and dark mode stays twenty lines."
```

---

### Task 5: Column CRUD actions

**Files:**
- Create: `src/app/board/actions.ts`
- Test: `src/app/board/actions.test.ts`

**Interfaces:**
- Consumes: schemas (Task 4); `run`, `assertNoError` from `src/app/tasks/action-run.ts`; `requireUser`, `assertWorkspaceMember`, `ForbiddenError` from `src/lib/auth.ts`; `parseInput` from `src/app/tasks/schemas.ts`; `delete_board_column` RPC (Task 2).
- Produces: `createBoardColumn(input): Promise<ActionResult<{ columnId: string }>>`, `renameBoardColumn(input): Promise<ActionResult>`, `setBoardColumnColor(input): Promise<ActionResult>`, `reorderBoardColumn(input): Promise<ActionResult>`, `deleteBoardColumn(input): Promise<ActionResult>`, `listTasksInColumn(input): Promise<ActionResult<{ tasks: ColumnTask[] }>>` where `ColumnTask = { id: string; title: string; completedAt: string | null }`, and the internal helper `assertColumnMember(columnId, authUserId): Promise<{ workspaceId: string }>`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/board/actions.test.ts`:

```ts
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createFakeSupabase, type Row, type Tables } from "@/test/supabase-fake";
import {
  createBoardColumn,
  deleteBoardColumn,
  listTasksInColumn,
  renameBoardColumn,
  setBoardColumnColor,
} from "./actions";

beforeEach(() => jest.clearAllMocks());

const WS1 = "a0000000-0000-4000-8000-000000000001";
const WS2 = "a0000000-0000-4000-8000-000000000002";
const M1 = "b0000000-0000-4000-8000-000000000001";
const M_OUTSIDER = "b0000000-0000-4000-8000-000000000003";
const COL_A = "e0000000-0000-4000-8000-00000000000a";
const COL_B = "e0000000-0000-4000-8000-00000000000b";
const COL_DONE = "e0000000-0000-4000-8000-00000000000d";
const COL_WS2 = "e0000000-0000-4000-8000-00000000000f";
const T1 = "c0000000-0000-4000-8000-000000000001";
const T2 = "c0000000-0000-4000-8000-000000000002";

/** WS1 has three columns and two tasks in COL_A; WS2 exists so cross-workspace cases are real. */
function seed(): Tables {
  return {
    workspace_members: [
      { id: M1, workspace_id: WS1, auth_user_id: "auth-user-1", display_name: "Alice" },
      { id: M_OUTSIDER, workspace_id: WS2, auth_user_id: "auth-user-3", display_name: "Carol" },
    ],
    board_columns: [
      { id: COL_A, workspace_id: WS1, name: "Blocked", color: "tab20-red", position: 1000, is_done: false },
      { id: COL_B, workspace_id: WS1, name: "In Progress", color: "tab20-blue", position: 2000, is_done: false },
      { id: COL_DONE, workspace_id: WS1, name: "Completed", color: "tab20-green", position: 3000, is_done: true },
      { id: COL_WS2, workspace_id: WS2, name: "Not Started", color: "tab20-grey", position: 1000, is_done: false },
    ],
    tasks: [
      { id: T1, workspace_id: WS1, parent_task_id: null, completed_at: null, title: "Call the plumber", board_column_id: COL_A },
      { id: T2, workspace_id: WS1, parent_task_id: null, completed_at: null, title: "Fix the light", board_column_id: COL_A },
    ],
    task_assignments: [
      { task_id: T1, member_id: M1, member_sort_key: 1000 },
      { task_id: T2, member_id: M1, member_sort_key: 2000 },
    ],
  };
}

function setup(options: { tables?: Tables; user?: { id: string } | null } = {}) {
  const fake = createFakeSupabase({
    tables: options.tables ?? seed(),
    user: options.user === undefined ? { id: "auth-user-1" } : options.user,
  });
  (createClient as jest.Mock).mockResolvedValue(fake);
  (createAdminClient as jest.Mock).mockReturnValue(fake);
  return fake;
}

const columnsIn = (t: Tables) => t.board_columns as Row[];
const tasksIn = (t: Tables) => t.tasks as Row[];

async function expectFailure(promise: Promise<{ ok: boolean }>, expected: string) {
  expect(await promise).toEqual({ ok: false, error: expect.stringContaining(expected) });
}

// ─── createBoardColumn ───────────────────────────────────────────────────────

it("creates a column at the end of the workspace's list", async () => {
  const fake = setup();

  const result = await createBoardColumn({ workspaceId: WS1, name: "Waiting", color: "tab20-cyan" });

  expect(result.ok).toBe(true);
  const created = columnsIn(fake.tables).find((c) => c.name === "Waiting");
  expect(created).toMatchObject({ workspace_id: WS1, color: "tab20-cyan", is_done: false });
  expect(created!.position).toBeGreaterThan(3000);
});

it("refuses to create a column in a workspace the user does not belong to", async () => {
  const fake = setup();

  await expectFailure(
    createBoardColumn({ workspaceId: WS2, name: "Waiting", color: "tab20-cyan" }),
    "not a member of workspace"
  );
  expect(columnsIn(fake.tables).filter((c) => c.workspace_id === WS2)).toHaveLength(1);
});

it("signed out, creates nothing", async () => {
  const fake = setup({ user: null });

  await expectFailure(
    createBoardColumn({ workspaceId: WS1, name: "Waiting", color: "tab20-cyan" }),
    "Unauthorized"
  );
  expect(columnsIn(fake.tables)).toHaveLength(4);
});

// ─── renameBoardColumn ───────────────────────────────────────────────────────

it("renames in place, leaving every task's column untouched", async () => {
  const fake = setup();

  const result = await renameBoardColumn({ columnId: COL_A, name: "Parked" });

  expect(result.ok).toBe(true);
  expect(columnsIn(fake.tables).find((c) => c.id === COL_A)!.name).toBe("Parked");
  expect(tasksIn(fake.tables).map((t) => t.board_column_id)).toEqual([COL_A, COL_A]);
});

it("refuses to rename a column in another workspace", async () => {
  setup();
  await expectFailure(renameBoardColumn({ columnId: COL_WS2, name: "Parked" }), "not a member of workspace");
});

// ─── setBoardColumnColor ─────────────────────────────────────────────────────

it("changes only the colour", async () => {
  const fake = setup();

  const result = await setBoardColumnColor({ columnId: COL_A, color: "tab20-olive" });

  expect(result.ok).toBe(true);
  expect(columnsIn(fake.tables).find((c) => c.id === COL_A)).toMatchObject({
    color: "tab20-olive",
    name: "Blocked",
    position: 1000,
  });
});

// ─── listTasksInColumn ───────────────────────────────────────────────────────

it("lists the column's tasks in the caller's own priority order", async () => {
  const tables = seed();
  (tables.task_assignments as Row[])[1].member_sort_key = 500; // T2 outranks T1 for this user
  setup({ tables });

  const result = await listTasksInColumn({ columnId: COL_A });

  expect(result).toEqual({
    ok: true,
    tasks: [
      { id: T2, title: "Fix the light", completedAt: null },
      { id: T1, title: "Call the plumber", completedAt: null },
    ],
  });
});

it("returns an empty list for a column with no tasks", async () => {
  setup();
  expect(await listTasksInColumn({ columnId: COL_B })).toEqual({ ok: true, tasks: [] });
});

// ─── deleteBoardColumn ───────────────────────────────────────────────────────

it("applies each task's own destination and removes the column", async () => {
  const fake = setup();

  const result = await deleteBoardColumn({
    columnId: COL_A,
    moves: [
      { taskId: T1, targetColumnId: COL_B },
      { taskId: T2, targetColumnId: COL_DONE },
    ],
  });

  expect(result.ok).toBe(true);
  expect(tasksIn(fake.tables).find((t) => t.id === T1)!.board_column_id).toBe(COL_B);
  expect(tasksIn(fake.tables).find((t) => t.id === T2)!.board_column_id).toBe(COL_DONE);
  expect(columnsIn(fake.tables).some((c) => c.id === COL_A)).toBe(false);
});

it("deletes an empty column with no moves", async () => {
  const fake = setup();

  const result = await deleteBoardColumn({ columnId: COL_B, moves: [] });

  expect(result.ok).toBe(true);
  expect(columnsIn(fake.tables).some((c) => c.id === COL_B)).toBe(false);
});

it("refuses a partial move list and changes nothing", async () => {
  const fake = setup();

  await expectFailure(
    deleteBoardColumn({ columnId: COL_A, moves: [{ taskId: T1, targetColumnId: COL_B }] }),
    "changed since it was listed"
  );
  expect(columnsIn(fake.tables).some((c) => c.id === COL_A)).toBe(true);
  expect(tasksIn(fake.tables).map((t) => t.board_column_id)).toEqual([COL_A, COL_A]);
});

it("refuses a destination in another workspace", async () => {
  const fake = setup();

  await expectFailure(
    deleteBoardColumn({
      columnId: COL_A,
      moves: [
        { taskId: T1, targetColumnId: COL_WS2 },
        { taskId: T2, targetColumnId: COL_B },
      ],
    }),
    "different column in workspace"
  );
  expect(columnsIn(fake.tables).some((c) => c.id === COL_A)).toBe(true);
});

it("refuses to delete a column in another workspace", async () => {
  setup();
  await expectFailure(deleteBoardColumn({ columnId: COL_WS2, moves: [] }), "not a member of workspace");
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/app/board/actions.test.ts`
Expected: FAIL — `Cannot find module './actions'`.

- [ ] **Step 3: Write the actions**

Create `src/app/board/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { assertWorkspaceMember, memberIdsForUser, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/tasks/action-result";
import { assertNoError, run } from "@/app/tasks/action-run";
import { parseInput } from "@/app/tasks/schemas";
import {
  createBoardColumnSchema,
  deleteBoardColumnSchema,
  listTasksInColumnSchema,
  renameBoardColumnSchema,
  reorderBoardColumnSchema,
  setBoardColumnColorSchema,
  type CreateBoardColumnInput,
  type DeleteBoardColumnInput,
  type ListTasksInColumnInput,
  type RenameBoardColumnInput,
  type ReorderBoardColumnInput,
  type SetBoardColumnColorInput,
} from "./schemas";

export type ColumnTask = { id: string; title: string; completedAt: string | null };

/**
 * Columns are shared, so authorization is workspace membership rather than task assignment: any
 * member may edit any column of their workspace. The column id arrives from the network, so the
 * workspace it belongs to is read here rather than trusted from the caller.
 */
async function assertColumnMember(
  columnId: string,
  authUserId: string
): Promise<{ workspaceId: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("board_columns")
    .select("workspace_id")
    .eq("id", columnId)
    .maybeSingle();

  assertNoError("load board column", { error });
  if (!data) throw new Error(`board column ${columnId} not found`);

  const workspaceId = data.workspace_id as string;
  await assertWorkspaceMember(workspaceId, authUserId);

  return { workspaceId };
}

export async function createBoardColumn(
  input: CreateBoardColumnInput
): Promise<ActionResult<{ columnId: string }>> {
  return run("createBoardColumn", async () => {
    const { user } = await requireUser();
    const { workspaceId, name, color } = parseInput(createBoardColumnSchema, input);
    await assertWorkspaceMember(workspaceId, user.id);

    const admin = createAdminClient();

    // Sparse positions, the same convention member_sort_key uses: a new column lands a full step
    // past the last one so reordering later only ever needs a midpoint.
    const { data: last, error: lastError } = await admin
      .from("board_columns")
      .select("position")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: false })
      .limit(1);

    assertNoError("load last column position", { error: lastError });

    const position = ((last?.[0]?.position as number | undefined) ?? 0) + 1000;
    const columnId = crypto.randomUUID();

    assertNoError(
      "create board column",
      await admin
        .from("board_columns")
        .insert({ id: columnId, workspace_id: workspaceId, name, color, position, is_done: false })
    );

    revalidatePath("/board");
    revalidatePath("/settings");
    return { columnId };
  });
}

/**
 * Renaming is in place: it touches the column row only. No task's board_column_id changes, so a
 * rename can never move a card — which is what makes it safe to do on blur without confirmation.
 */
export async function renameBoardColumn(input: RenameBoardColumnInput): Promise<ActionResult> {
  return run("renameBoardColumn", async () => {
    const { user } = await requireUser();
    const { columnId, name } = parseInput(renameBoardColumnSchema, input);
    await assertColumnMember(columnId, user.id);

    const admin = createAdminClient();
    assertNoError(
      "rename board column",
      await admin.from("board_columns").update({ name }).eq("id", columnId)
    );

    revalidatePath("/board");
    revalidatePath("/settings");
    return {};
  });
}

export async function setBoardColumnColor(input: SetBoardColumnColorInput): Promise<ActionResult> {
  return run("setBoardColumnColor", async () => {
    const { user } = await requireUser();
    const { columnId, color } = parseInput(setBoardColumnColorSchema, input);
    await assertColumnMember(columnId, user.id);

    const admin = createAdminClient();
    assertNoError(
      "set board column colour",
      await admin.from("board_columns").update({ color }).eq("id", columnId)
    );

    revalidatePath("/board");
    revalidatePath("/settings");
    return {};
  });
}

export async function reorderBoardColumn(input: ReorderBoardColumnInput): Promise<ActionResult> {
  return run("reorderBoardColumn", async () => {
    const { user } = await requireUser();
    const { columnId, prevPosition, nextPosition } = parseInput(reorderBoardColumnSchema, input);
    await assertColumnMember(columnId, user.id);

    // Only column in the list: nothing to order against, so the position stands.
    if (prevPosition === null && nextPosition === null) return {};

    const position =
      prevPosition === null
        ? nextPosition! - 1000
        : nextPosition === null
          ? prevPosition + 1000
          : (prevPosition + nextPosition) / 2;

    const admin = createAdminClient();
    assertNoError(
      "reorder board column",
      await admin.from("board_columns").update({ position }).eq("id", columnId)
    );

    revalidatePath("/board");
    revalidatePath("/settings");
    return {};
  });
}

/**
 * The tasks the delete dialog must offer a destination for, ordered by the caller's own priority so
 * the top of the dialog is the work they care about most.
 */
export async function listTasksInColumn(
  input: ListTasksInColumnInput
): Promise<ActionResult<{ tasks: ColumnTask[] }>> {
  return run("listTasksInColumn", async () => {
    const { user } = await requireUser();
    const { columnId } = parseInput(listTasksInColumnSchema, input);
    await assertColumnMember(columnId, user.id);

    const admin = createAdminClient();
    const { data: taskRows, error: taskError } = await admin
      .from("tasks")
      .select("id, title, completed_at")
      .eq("board_column_id", columnId);

    assertNoError("load column tasks", { error: taskError });

    const rows = taskRows ?? [];
    if (rows.length === 0) return { tasks: [] };

    // Ordering is per user, so it comes from task_assignments rather than from the tasks table. A
    // task the caller is not assigned to has no key for them; it sorts last rather than vanishing,
    // because the deletion still has to account for it.
    const ownMemberIds = await memberIdsForUser(user.id);
    const { data: keyRows, error: keyError } = await admin
      .from("task_assignments")
      .select("task_id, member_sort_key")
      .in("task_id", rows.map((r) => r.id as string))
      .in("member_id", ownMemberIds);

    assertNoError("load column task order", { error: keyError });

    const keyByTaskId = new Map<string, number>();
    (keyRows ?? []).forEach((r) => keyByTaskId.set(r.task_id as string, r.member_sort_key as number));

    const tasks: ColumnTask[] = rows
      .map((r) => ({
        id: r.id as string,
        title: r.title as string,
        completedAt: (r.completed_at as string | null) ?? null,
      }))
      .sort(
        (a, b) =>
          (keyByTaskId.get(a.id) ?? Number.POSITIVE_INFINITY) -
          (keyByTaskId.get(b.id) ?? Number.POSITIVE_INFINITY)
      );

    return { tasks };
  });
}

/**
 * Deletes a column after moving each of its tasks to the destination the user chose for it.
 *
 * The whole operation is one RPC because a column cannot be dropped while tasks still reference it
 * (the FK is `restrict`), and the reassignment must not be visible without the deletion that
 * justified it. The RPC also re-checks that `moves` covers exactly what is in the column right now,
 * which is what makes a stale dialog fail instead of relocating a task nobody chose for.
 */
export async function deleteBoardColumn(input: DeleteBoardColumnInput): Promise<ActionResult> {
  return run("deleteBoardColumn", async () => {
    const { user } = await requireUser();
    const { columnId, moves } = parseInput(deleteBoardColumnSchema, input);
    await assertColumnMember(columnId, user.id);

    const admin = createAdminClient();
    const { error } = await admin.rpc("delete_board_column", {
      p_column_id: columnId,
      p_moves: moves.map((m) => ({ task_id: m.taskId, target_column_id: m.targetColumnId })),
    });

    assertNoError("delete board column", { error });

    revalidatePath("/board");
    revalidatePath("/settings");
    revalidatePath("/tasks");
    return {};
  });
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx jest src/app/board/actions.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/app/board/actions.ts src/app/board/actions.test.ts
git commit -m "feat(board): add column CRUD and the delete listing action

Authorization is workspace membership, not task assignment, because
columns are shared: the column id arrives from the network, so its
workspace is read server-side rather than trusted.

deleteBoardColumn delegates to the RPC so the reassignment and the drop
are one transaction; listTasksInColumn orders by the caller's own
member_sort_key so the dialog leads with their top priorities."
```

---

### Task 6: The drop action and the done-column pagination

**Files:**
- Create: `src/app/board/move-actions.ts`
- Test: `src/app/board/move-actions.test.ts`

**Interfaces:**
- Consumes: `moveTaskToColumnSchema`, `loadOlderDoneSchema` (Task 4); `move_task_to_column` RPC (Task 2); `completeTask`, `reopenTask` from `src/app/tasks/actions.ts`; `assertTaskAssignee`, `memberIdsForUser`, `ForbiddenError` from `src/lib/auth.ts`.
- Produces: `moveTaskToColumn(input): Promise<ActionResult>`, `loadOlderDone(input): Promise<ActionResult<{ tasks: DoneTask[]; hasMore: boolean }>>` where `DoneTask = { id: string; title: string; dueAt: string | null; completedAt: string; workspaceId: string; boardColumnId: string; memberSortKey: number }`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/board/move-actions.test.ts`:

```ts
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createFakeSupabase, type Row, type Tables } from "@/test/supabase-fake";
import { loadOlderDone, moveTaskToColumn } from "./move-actions";

beforeEach(() => jest.clearAllMocks());

const WS1 = "a0000000-0000-4000-8000-000000000001";
const WS2 = "a0000000-0000-4000-8000-000000000002";
const M1 = "b0000000-0000-4000-8000-000000000001";
const M1_WS2 = "b0000000-0000-4000-8000-000000000004";
const COL_A = "e0000000-0000-4000-8000-00000000000a";
const COL_B = "e0000000-0000-4000-8000-00000000000b";
const COL_DONE = "e0000000-0000-4000-8000-00000000000d";
const COL_WS2 = "e0000000-0000-4000-8000-00000000000f";
const T1 = "c0000000-0000-4000-8000-000000000001";
const T2 = "c0000000-0000-4000-8000-000000000002";
const SUB = "d0000000-0000-4000-8000-000000000002";

function seed(): Tables {
  return {
    workspace_members: [
      { id: M1, workspace_id: WS1, auth_user_id: "auth-user-1", display_name: "Alice" },
      { id: M1_WS2, workspace_id: WS2, auth_user_id: "auth-user-1", display_name: "Alice" },
    ],
    board_columns: [
      { id: COL_A, workspace_id: WS1, name: "Blocked", color: "tab20-red", position: 1000, is_done: false },
      { id: COL_B, workspace_id: WS1, name: "In Progress", color: "tab20-blue", position: 2000, is_done: false },
      { id: COL_DONE, workspace_id: WS1, name: "Completed", color: "tab20-green", position: 3000, is_done: true },
      { id: COL_WS2, workspace_id: WS2, name: "Not Started", color: "tab20-grey", position: 1000, is_done: false },
    ],
    tasks: [
      { id: T1, workspace_id: WS1, parent_task_id: null, completed_at: null, title: "T1", board_column_id: COL_A },
      { id: T2, workspace_id: WS1, parent_task_id: null, completed_at: null, title: "T2", board_column_id: COL_B },
      { id: SUB, workspace_id: null, parent_task_id: T1, completed_at: null, title: "Sub", board_column_id: null },
    ],
    task_assignments: [
      { task_id: T1, member_id: M1, member_sort_key: 1000 },
      { task_id: T2, member_id: M1, member_sort_key: 2000 },
      { task_id: SUB, member_id: M1, member_sort_key: 3000 },
    ],
  };
}

function setup(options: { tables?: Tables; user?: { id: string } | null } = {}) {
  const fake = createFakeSupabase({
    tables: options.tables ?? seed(),
    user: options.user === undefined ? { id: "auth-user-1" } : options.user,
  });
  (createClient as jest.Mock).mockResolvedValue(fake);
  (createAdminClient as jest.Mock).mockReturnValue(fake);
  return fake;
}

const taskIn = (t: Tables, id: string) => (t.tasks as Row[]).find((r) => r.id === id)!;
const keyFor = (t: Tables, id: string) =>
  (t.task_assignments as Row[]).find((r) => r.task_id === id && r.member_id === M1)!.member_sort_key;

async function expectFailure(promise: Promise<{ ok: boolean }>, expected: string) {
  expect(await promise).toEqual({ ok: false, error: expect.stringContaining(expected) });
}

// ─── moveTaskToColumn ────────────────────────────────────────────────────────

it("moves the card to the new column and repositions it for the dragger", async () => {
  const fake = setup();

  const result = await moveTaskToColumn({
    taskId: T1,
    columnId: COL_B,
    memberId: M1,
    prevKey: 2000,
    nextKey: null,
  });

  expect(result.ok).toBe(true);
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_B);
  expect(keyFor(fake.tables, T1)).toBe(3000);
});

it("completes the task when the destination is the terminal column", async () => {
  const fake = setup();

  const result = await moveTaskToColumn({
    taskId: T1,
    columnId: COL_DONE,
    memberId: M1,
    prevKey: null,
    nextKey: null,
  });

  expect(result.ok).toBe(true);
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_DONE);
  expect(taskIn(fake.tables, T1).completed_at).not.toBeNull();
  // completeTask's existing cascade still applies: an open subtask closes with its parent.
  expect(taskIn(fake.tables, SUB).completed_at).not.toBeNull();
});

it("reopens the task when it is dragged out of the terminal column", async () => {
  const tables = seed();
  taskIn(tables, T1).completed_at = "2026-08-20T10:00:00.000Z";
  taskIn(tables, T1).board_column_id = COL_DONE;
  const fake = setup({ tables });

  const result = await moveTaskToColumn({
    taskId: T1,
    columnId: COL_A,
    memberId: M1,
    prevKey: null,
    nextKey: null,
  });

  expect(result.ok).toBe(true);
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_A);
  expect(taskIn(fake.tables, T1).completed_at).toBeNull();
});

it("leaves completion alone when both columns are non-terminal", async () => {
  const fake = setup();

  await moveTaskToColumn({ taskId: T1, columnId: COL_B, memberId: M1, prevKey: null, nextKey: null });

  expect(taskIn(fake.tables, T1).completed_at).toBeNull();
});

it("refuses a column belonging to another workspace", async () => {
  const fake = setup();

  await expectFailure(
    moveTaskToColumn({ taskId: T1, columnId: COL_WS2, memberId: M1, prevKey: null, nextKey: null }),
    "not in workspace"
  );
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_A);
});

it("refuses a member id that is not the caller's own", async () => {
  const fake = setup();

  await expectFailure(
    moveTaskToColumn({ taskId: T1, columnId: COL_B, memberId: M1_WS2, prevKey: null, nextKey: null }),
    "does not belong to the current user"
  );
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_A);
});

it("refuses to move a subtask", async () => {
  const fake = setup();

  await expectFailure(
    moveTaskToColumn({ taskId: SUB, columnId: COL_B, memberId: M1, prevKey: null, nextKey: null }),
    "subtask"
  );
  expect(taskIn(fake.tables, SUB).board_column_id).toBeNull();
});

it("signed out, moves nothing", async () => {
  const fake = setup({ user: null });

  await expectFailure(
    moveTaskToColumn({ taskId: T1, columnId: COL_B, memberId: M1, prevKey: null, nextKey: null }),
    "Unauthorized"
  );
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_A);
});

// ─── loadOlderDone ───────────────────────────────────────────────────────────

it("returns completed tasks strictly older than the cursor, newest first", async () => {
  const tables = seed();
  (tables.tasks as Row[]).push(
    { id: "c0000000-0000-4000-8000-000000000010", workspace_id: WS1, parent_task_id: null, title: "Older", due_at: null, completed_at: "2026-07-01T10:00:00.000Z", board_column_id: COL_DONE },
    { id: "c0000000-0000-4000-8000-000000000011", workspace_id: WS1, parent_task_id: null, title: "Oldest", due_at: null, completed_at: "2026-06-01T10:00:00.000Z", board_column_id: COL_DONE },
    { id: "c0000000-0000-4000-8000-000000000012", workspace_id: WS1, parent_task_id: null, title: "Newer", due_at: null, completed_at: "2026-08-20T10:00:00.000Z", board_column_id: COL_DONE }
  );
  (tables.task_assignments as Row[]).push(
    { task_id: "c0000000-0000-4000-8000-000000000010", member_id: M1, member_sort_key: 4000 },
    { task_id: "c0000000-0000-4000-8000-000000000011", member_id: M1, member_sort_key: 5000 },
    { task_id: "c0000000-0000-4000-8000-000000000012", member_id: M1, member_sort_key: 6000 }
  );
  setup({ tables });

  const result = await loadOlderDone({ workspaceIds: [WS1], before: "2026-08-01T00:00:00.000Z" });

  expect(result).toMatchObject({ ok: true, hasMore: false });
  expect(result.ok && result.tasks.map((t) => t.title)).toEqual(["Older", "Oldest"]);
});

it("returns nothing when no completed task is older than the cursor", async () => {
  setup();

  const result = await loadOlderDone({ workspaceIds: [WS1], before: "2026-01-01T00:00:00.000Z" });

  expect(result).toEqual({ ok: true, tasks: [], hasMore: false });
});

it("refuses a workspace the user does not belong to", async () => {
  setup();
  await expectFailure(
    loadOlderDone({ workspaceIds: ["a0000000-0000-4000-8000-000000000009"], before: "2026-08-01T00:00:00.000Z" }),
    "not a member of workspace"
  );
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/app/board/move-actions.test.ts`
Expected: FAIL — `Cannot find module './move-actions'`.

- [ ] **Step 3: Write the actions**

Create `src/app/board/move-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError, memberIdsForUser, requireUser, assertTaskAssignee, assertWorkspaceMember } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/tasks/action-result";
import { assertNoError, run } from "@/app/tasks/action-run";
import { completeTask, reopenTask } from "@/app/tasks/actions";
import { parseInput } from "@/app/tasks/schemas";
import {
  loadOlderDoneSchema,
  moveTaskToColumnSchema,
  type LoadOlderDoneInput,
  type MoveTaskToColumnInput,
} from "./schemas";

/** One page of already-completed tasks, for the done column's "show older" footer. */
export type DoneTask = {
  id: string;
  title: string;
  dueAt: string | null;
  completedAt: string;
  workspaceId: string;
  boardColumnId: string;
  memberSortKey: number;
};

const DONE_PAGE_SIZE = 50;

/**
 * Applies a drop: the shared column, the dragger's own position, and — when a terminal column is
 * involved — completion.
 *
 * Completion is not stored twice. A completed task renders in the terminal column regardless of its
 * board_column_id, so dropping into that column has to actually complete the task, and dragging out
 * has to reopen it, or the board and the list view would disagree about what is done. Both paths
 * delegate to the existing actions rather than writing completed_at here, so the subtask cascade
 * documented in docs/product.md keeps applying.
 */
export async function moveTaskToColumn(input: MoveTaskToColumnInput): Promise<ActionResult> {
  return run("moveTaskToColumn", async () => {
    const { user } = await requireUser();
    const { taskId, columnId, memberId, prevKey, nextKey } = parseInput(moveTaskToColumnSchema, input);

    // member_sort_key is per-user priority: a caller may only reposition their own list.
    const ownMemberIds = await memberIdsForUser(user.id);
    if (!ownMemberIds.includes(memberId)) {
      throw new ForbiddenError(`member ${memberId} does not belong to the current user`);
    }

    await assertTaskAssignee(taskId, user.id);

    const admin = createAdminClient();

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("completed_at, parent_task_id, board_column_id")
      .eq("id", taskId)
      .maybeSingle();

    assertNoError("load task", { error: taskError });
    if (!task) throw new Error(`task ${taskId} not found`);
    if (task.parent_task_id) {
      throw new ForbiddenError(`task ${taskId} is a subtask and has no board column`);
    }

    const { data: target, error: targetError } = await admin
      .from("board_columns")
      .select("is_done")
      .eq("id", columnId)
      .maybeSingle();

    assertNoError("load target column", { error: targetError });
    if (!target) throw new Error(`board column ${columnId} not found`);

    const { error: moveError } = await admin.rpc("move_task_to_column", {
      p_task_id: taskId,
      p_column_id: columnId,
      p_member_id: memberId,
      p_prev_key: prevKey,
      p_next_key: nextKey,
    });

    assertNoError("move task to column", { error: moveError });

    const wasCompleted = task.completed_at !== null;
    const targetIsDone = target.is_done === true;

    if (targetIsDone && !wasCompleted) {
      const result = await completeTask(taskId);
      if (!result.ok) throw new Error(`complete task: ${result.error}`);
    } else if (!targetIsDone && wasCompleted) {
      const result = await reopenTask(taskId);
      if (!result.ok) throw new Error(`reopen task: ${result.error}`);
    }

    revalidatePath("/board");
    revalidatePath("/tasks");
    return {};
  });
}

/**
 * The next page of older completed tasks for the done column.
 *
 * Keyset pagination on completed_at rather than an offset: reopening a task while the list is open
 * shifts every later row by one, so an offset would silently skip a task. A cursor cannot.
 */
export async function loadOlderDone(
  input: LoadOlderDoneInput
): Promise<ActionResult<{ tasks: DoneTask[]; hasMore: boolean }>> {
  return run("loadOlderDone", async () => {
    const { user } = await requireUser();
    const { workspaceIds, before } = parseInput(loadOlderDoneSchema, input);

    for (const workspaceId of workspaceIds) {
      await assertWorkspaceMember(workspaceId, user.id);
    }

    const admin = createAdminClient();
    const ownMemberIds = await memberIdsForUser(user.id);

    // Visibility is assignment, so the caller's own assignment rows are the starting point.
    const { data: assignments, error: assignmentError } = await admin
      .from("task_assignments")
      .select("task_id, member_sort_key")
      .in("member_id", ownMemberIds);

    assertNoError("load assignments", { error: assignmentError });

    const keyByTaskId = new Map<string, number>();
    (assignments ?? []).forEach((a) =>
      keyByTaskId.set(a.task_id as string, a.member_sort_key as number)
    );

    if (keyByTaskId.size === 0) return { tasks: [], hasMore: false };

    const { data: rows, error: rowError } = await admin
      .from("tasks")
      .select("id, title, due_at, completed_at, workspace_id, board_column_id")
      .in("id", [...keyByTaskId.keys()])
      .in("workspace_id", workspaceIds)
      .is("parent_task_id", null)
      .not("completed_at", "is", null)
      .lt("completed_at", before)
      .order("completed_at", { ascending: false })
      .limit(DONE_PAGE_SIZE + 1);

    assertNoError("load older completed tasks", { error: rowError });

    const page = rows ?? [];
    const hasMore = page.length > DONE_PAGE_SIZE;

    const tasks: DoneTask[] = page.slice(0, DONE_PAGE_SIZE).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      dueAt: (r.due_at as string | null) ?? null,
      completedAt: r.completed_at as string,
      workspaceId: r.workspace_id as string,
      boardColumnId: r.board_column_id as string,
      memberSortKey: keyByTaskId.get(r.id as string) ?? 0,
    }));

    return { tasks, hasMore };
  });
}
```

If `.not("completed_at", "is", null)` or `.lt(...)` are unsupported by the fake, add them to
`src/test/supabase-fake.ts` alongside the existing `eq`/`in`/`is` filters — a `not` filter kind and a
`lt` filter kind, both following the existing `matches()` shape — and cover them with a case in
`src/test/supabase-fake.test.ts`. Do not weaken the query to fit the fake.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx jest src/app/board/move-actions.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/app/board/move-actions.ts src/app/board/move-actions.test.ts src/test/supabase-fake.ts src/test/supabase-fake.test.ts
git commit -m "feat(board): apply drops and paginate the done column

A drop into the terminal column delegates to completeTask, and out of it
to reopenTask, so completion is stored once and the subtask cascade in
docs/product.md keeps applying — the board and the list view cannot
disagree about what is done.

loadOlderDone pages on completed_at rather than an offset: reopening a
task mid-list shifts every later row, which an offset would silently
skip."
```

---

### Task 7: New tasks land in the leftmost column

**Files:**
- Modify: `src/app/tasks/actions.ts` (`createTaskWithSubtasks`, around the `tasks` insert)
- Test: `src/app/tasks/actions.test.ts` (the `createTaskWithSubtasks` block)

**Interfaces:**
- Consumes: `board_columns` (Task 1).
- Produces: no new exports. `createTaskWithSubtasks` now writes `board_column_id` on the root task.

Migration 015's check constraint makes a root task without a column impossible, so this is not a
nicety — task creation breaks without it.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/tasks/actions.test.ts` in the `createTaskWithSubtasks` section. The shared `seed()`
fixture needs columns, so extend it there too:

```ts
// Added to seed(): WS1's columns, so a created task has somewhere to land.
const COL_FIRST = "e0000000-0000-4000-8000-00000000000a";
const COL_SECOND = "e0000000-0000-4000-8000-00000000000b";
const COL_TERMINAL = "e0000000-0000-4000-8000-00000000000d";

// board_columns: [
//   { id: COL_FIRST, workspace_id: WS1, name: "Not Started", color: "tab20-grey", position: 1000, is_done: false },
//   { id: COL_SECOND, workspace_id: WS1, name: "In Progress", color: "tab20-blue", position: 2000, is_done: false },
//   { id: COL_TERMINAL, workspace_id: WS1, name: "Completed", color: "tab20-green", position: 500, is_done: true },
// ],

it("puts a new task in the workspace's leftmost non-terminal column", async () => {
  const fake = setup();

  const result = await createTaskWithSubtasks({
    title: "Buy milk",
    workspaceId: WS1,
    memberIds: [M1],
    subtasks: [],
  });

  expect(result.ok).toBe(true);
  const created = tasksIn(fake.tables).find((t) => t.title === "Buy milk");
  // COL_TERMINAL sits at position 500 — earlier than COL_FIRST — and is skipped anyway: a new task
  // is not done.
  expect(created!.board_column_id).toBe(COL_FIRST);
});

it("leaves subtasks without a column", async () => {
  const fake = setup();

  await createTaskWithSubtasks({
    title: "Parent",
    workspaceId: WS1,
    memberIds: [M1],
    subtasks: [{ title: "Child" }],
  });

  const child = tasksIn(fake.tables).find((t) => t.title === "Child");
  expect(child!.board_column_id ?? null).toBeNull();
});

it("fails clearly when the workspace has no usable column", async () => {
  const tables = seed();
  tables.board_columns = [
    { id: COL_TERMINAL, workspace_id: WS1, name: "Completed", color: "tab20-green", position: 500, is_done: true },
  ];
  const fake = setup({ tables });

  await expectFailure(
    createTaskWithSubtasks({ title: "Buy milk", workspaceId: WS1, memberIds: [M1], subtasks: [] }),
    GENERIC_ERROR
  );
  expect(tasksIn(fake.tables).some((t) => t.title === "Buy milk")).toBe(false);
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/app/tasks/actions.test.ts -t "leftmost non-terminal"`
Expected: FAIL — `expect(received).toBe(expected)`, received `undefined`.

- [ ] **Step 3: Implement**

In `src/app/tasks/actions.ts`, inside `createTaskWithSubtasks`, after `const admin = createAdminClient();` and before the `tasks` insert:

```ts
    // Migration 015 requires every root task to carry a board column, so this is part of creating a
    // task, not a board-only concern. The leftmost non-terminal column is the "new work" column:
    // is_done is excluded explicitly rather than relying on position, because a workspace may have
    // reordered its terminal column to the front.
    const { data: firstColumn, error: firstColumnError } = await admin
      .from("board_columns")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("is_done", false)
      .order("position", { ascending: true })
      .limit(1);

    assertNoError("load first board column", { error: firstColumnError });

    const boardColumnId = firstColumn?.[0]?.id as string | undefined;
    if (!boardColumnId) {
      throw new Error(`workspace ${workspaceId} has no non-terminal board column`);
    }
```

Then add the field to the insert:

```ts
      await admin.from("tasks").insert({
        id: parentId,
        title,
        description: description ?? null,
        due_at: dueAt ? `${dueAt}T00:00:00Z` : null,
        workspace_id: workspaceId,
        board_column_id: boardColumnId,
      })
```

`insertSubtask` is left alone: subtasks carry no workspace and no column, which the check constraint
enforces.

- [ ] **Step 4: Run the full tasks suite**

Run: `npx jest src/app/tasks/actions.test.ts`
Expected: PASS. The whole file must pass, not only the new tests — the shared `seed()` changed.

- [ ] **Step 5: Verify against dev that creation still works end to end**

```bash
npm run dev
```

Create a task through the UI in each workspace, then confirm each got a column:

```bash
psql "$SUPABASE_DEV_DB_URL" -c "select t.title, bc.name from public.tasks t join public.board_columns bc on bc.id = t.board_column_id order by t.created_at desc limit 5;"
```

Expected: the new tasks appear against their workspace's leftmost non-terminal column.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/app/tasks/actions.ts src/app/tasks/actions.test.ts
git commit -m "feat(tasks): give new tasks a board column

Migration 015 requires every root task to carry one, so this is part of
creating a task rather than a board concern. The leftmost non-terminal
column is chosen by excluding is_done explicitly, since a workspace may
have dragged its terminal column to the front."
```

---

### Task 8: Pure grouping — merge by name, bucket tasks, filter the done window

**Files:**
- Create: `src/app/board/group-columns.ts`
- Test: `src/app/board/group-columns.test.ts`
- Modify: `src/app/tasks/bucket-tasks.ts` (extract `deadlineFor`)

**Interfaces:**
- Consumes: `Tab20Slug` (Task 1).
- Produces:
  - `type BoardColumn = { id: string; workspaceId: string; name: string; color: Tab20Slug; position: number; isDone: boolean }`
  - `type BoardTask = { id: string; title: string; dueAt: string | null; completedAt: string | null; workspaceId: string; workspaceName: string; workspaceKind: string; boardColumnId: string; memberSortKey: number; assigneeCount: number }`
  - `type MergedColumn = { key: string; name: string; color: Tab20Slug | null; position: number; isDone: boolean; columnIdByWorkspaceId: Record<string, string> }`
  - `mergeColumns(columns: BoardColumn[]): MergedColumn[]`
  - `groupTasks(merged: MergedColumn[], tasks: BoardTask[], now?: Date): Record<string, BoardTask[]>`
  - `resolveDropTarget(column: MergedColumn, workspaceId: string): string | null`
  - `DONE_WINDOW_DAYS = 7`
  - From `src/app/tasks/bucket-tasks.ts`: `deadlineFor(dueAt: string | null, now: Date): { label: string | null; variant: "red" | "yellow" | "green" | null }`

- [ ] **Step 1: Write the failing tests**

Create `src/app/board/group-columns.test.ts`:

```ts
import {
  DONE_WINDOW_DAYS,
  groupTasks,
  mergeColumns,
  resolveDropTarget,
  type BoardColumn,
  type BoardTask,
} from "./group-columns";

const WS_H = "a0000000-0000-4000-8000-000000000001";
const WS_W = "a0000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-08-28T12:00:00.000Z");

function column(overrides: Partial<BoardColumn> & { id: string; workspaceId: string; name: string }): BoardColumn {
  return { color: "tab20-blue", position: 1000, isDone: false, ...overrides };
}

function task(overrides: Partial<BoardTask> & { id: string; boardColumnId: string; workspaceId: string }): BoardTask {
  return {
    title: "A task",
    dueAt: null,
    completedAt: null,
    workspaceName: "Household",
    workspaceKind: "household",
    memberSortKey: 1000,
    assigneeCount: 1,
    ...overrides,
  };
}

describe("mergeColumns", () => {
  it("keeps one workspace's columns in position order", () => {
    const merged = mergeColumns([
      column({ id: "c2", workspaceId: WS_H, name: "In Progress", position: 2000 }),
      column({ id: "c1", workspaceId: WS_H, name: "Not Started", position: 1000 }),
    ]);

    expect(merged.map((m) => m.name)).toEqual(["Not Started", "In Progress"]);
    expect(merged[0].columnIdByWorkspaceId).toEqual({ [WS_H]: "c1" });
  });

  it("merges same-named columns across workspaces, case-insensitively", () => {
    const merged = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Blocked", position: 3000 }),
      column({ id: "w1", workspaceId: WS_W, name: "blocked", position: 1000 }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Blocked");
    expect(merged[0].columnIdByWorkspaceId).toEqual({ [WS_H]: "h1", [WS_W]: "w1" });
  });

  it("takes the lowest position of the columns it merged", () => {
    const merged = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Blocked", position: 3000 }),
      column({ id: "w1", workspaceId: WS_W, name: "Blocked", position: 1000 }),
      column({ id: "h2", workspaceId: WS_H, name: "Done", position: 2000, isDone: true }),
    ]);

    expect(merged.map((m) => m.name)).toEqual(["Blocked", "Done"]);
    expect(merged[0].position).toBe(1000);
  });

  it("keeps a shared colour and drops to null when merged columns disagree", () => {
    const agreeing = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Blocked", color: "tab20-red" }),
      column({ id: "w1", workspaceId: WS_W, name: "Blocked", color: "tab20-red" }),
    ]);
    const disagreeing = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Blocked", color: "tab20-red" }),
      column({ id: "w1", workspaceId: WS_W, name: "Blocked", color: "tab20-cyan" }),
    ]);

    expect(agreeing[0].color).toBe("tab20-red");
    expect(disagreeing[0].color).toBeNull();
  });

  it("is terminal when any merged column is terminal", () => {
    const merged = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Completed", isDone: true }),
      column({ id: "w1", workspaceId: WS_W, name: "Completed", isDone: false }),
    ]);

    expect(merged[0].isDone).toBe(true);
  });

  it("keeps a name unique to one workspace as its own column", () => {
    const merged = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Not Started", position: 1000 }),
      column({ id: "w1", workspaceId: WS_W, name: "Waiting on legal", position: 2000 }),
    ]);

    expect(merged.map((m) => m.name)).toEqual(["Not Started", "Waiting on legal"]);
  });
});

describe("groupTasks", () => {
  const columns = mergeColumns([
    column({ id: "h1", workspaceId: WS_H, name: "Not Started", position: 1000 }),
    column({ id: "h2", workspaceId: WS_H, name: "Completed", position: 2000, isDone: true }),
  ]);

  it("buckets a task under the merged column its own column belongs to", () => {
    const grouped = groupTasks(columns, [task({ id: "t1", boardColumnId: "h1", workspaceId: WS_H })], NOW);

    expect(grouped["not started"].map((t) => t.id)).toEqual(["t1"]);
    expect(grouped["completed"]).toEqual([]);
  });

  it("sorts each column by the viewer's own priority", () => {
    const grouped = groupTasks(
      columns,
      [
        task({ id: "low", boardColumnId: "h1", workspaceId: WS_H, memberSortKey: 3000 }),
        task({ id: "high", boardColumnId: "h1", workspaceId: WS_H, memberSortKey: 1000 }),
      ],
      NOW
    );

    expect(grouped["not started"].map((t) => t.id)).toEqual(["high", "low"]);
  });

  it("puts a completed task in the terminal column whatever its board_column_id says", () => {
    const grouped = groupTasks(
      columns,
      [
        task({
          id: "done",
          boardColumnId: "h1",
          workspaceId: WS_H,
          completedAt: "2026-08-27T09:00:00.000Z",
        }),
      ],
      NOW
    );

    expect(grouped["not started"]).toEqual([]);
    expect(grouped["completed"].map((t) => t.id)).toEqual(["done"]);
  });

  it("shows only the last 7 days of completed work, newest first", () => {
    const grouped = groupTasks(
      columns,
      [
        task({ id: "recent", boardColumnId: "h2", workspaceId: WS_H, completedAt: "2026-08-27T09:00:00.000Z" }),
        task({ id: "older", boardColumnId: "h2", workspaceId: WS_H, completedAt: "2026-08-26T09:00:00.000Z" }),
        task({ id: "ancient", boardColumnId: "h2", workspaceId: WS_H, completedAt: "2026-07-01T09:00:00.000Z" }),
      ],
      NOW
    );

    expect(grouped["completed"].map((t) => t.id)).toEqual(["recent", "older"]);
    expect(DONE_WINDOW_DAYS).toBe(7);
  });

  it("drops a completed task entirely when no terminal column exists", () => {
    const noTerminal = mergeColumns([column({ id: "h1", workspaceId: WS_H, name: "Not Started" })]);

    const grouped = groupTasks(
      noTerminal,
      [task({ id: "done", boardColumnId: "h1", workspaceId: WS_H, completedAt: "2026-08-27T09:00:00.000Z" })],
      NOW
    );

    expect(grouped["not started"]).toEqual([]);
  });

  it("ignores a task whose column is not on the board", () => {
    const grouped = groupTasks(columns, [task({ id: "stray", boardColumnId: "gone", workspaceId: WS_H })], NOW);

    expect(Object.values(grouped).flat()).toEqual([]);
  });
});

describe("resolveDropTarget", () => {
  const merged = mergeColumns([
    column({ id: "h1", workspaceId: WS_H, name: "Blocked" }),
    column({ id: "w1", workspaceId: WS_W, name: "Blocked" }),
    column({ id: "w2", workspaceId: WS_W, name: "Waiting on legal" }),
  ]);

  it("resolves to the column of the card's own workspace", () => {
    expect(resolveDropTarget(merged[0], WS_H)).toBe("h1");
    expect(resolveDropTarget(merged[0], WS_W)).toBe("w1");
  });

  it("returns null when the card's workspace has no column by that name", () => {
    const waiting = merged.find((m) => m.name === "Waiting on legal")!;
    expect(resolveDropTarget(waiting, WS_H)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/app/board/group-columns.test.ts`
Expected: FAIL — `Cannot find module './group-columns'`.

- [ ] **Step 3: Write the grouping module**

Create `src/app/board/group-columns.ts`:

```ts
import type { Tab20Slug } from "./colors";

/**
 * Everything the board needs to decide what appears where, as pure functions.
 *
 * The board's server component fetches, this module arranges, and the client component renders.
 * Keeping the arrangement pure is what makes the merge rules and the done window testable without a
 * database or a DOM.
 */

export type BoardColumn = {
  id: string;
  workspaceId: string;
  name: string;
  color: Tab20Slug;
  position: number;
  isDone: boolean;
};

export type BoardTask = {
  id: string;
  title: string;
  dueAt: string | null;
  completedAt: string | null;
  workspaceId: string;
  workspaceName: string;
  workspaceKind: string;
  boardColumnId: string;
  memberSortKey: number;
  assigneeCount: number;
};

/**
 * A board column as rendered. In a single-workspace scope this is one row of board_columns; in the
 * all-workspaces scope it may stand for several, one per workspace, merged because they share a
 * name. `columnIdByWorkspaceId` is how a drop finds the real column to write.
 */
export type MergedColumn = {
  /** lower(name) — the identity a merge is keyed on, and the droppableId. */
  key: string;
  name: string;
  /** null when merged columns disagree about colour; the header then stays neutral. */
  color: Tab20Slug | null;
  position: number;
  isDone: boolean;
  columnIdByWorkspaceId: Record<string, string>;
};

/** docs/superpowers/specs/2026-08-26-kanban-board-design.md: the done column's default window. */
export const DONE_WINDOW_DAYS = 7;

export function mergeColumns(columns: BoardColumn[]): MergedColumn[] {
  const byKey = new Map<string, MergedColumn & { colorConflict: boolean }>();

  for (const column of columns) {
    const key = column.name.trim().toLowerCase();
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        key,
        name: column.name,
        color: column.color,
        position: column.position,
        isDone: column.isDone,
        columnIdByWorkspaceId: { [column.workspaceId]: column.id },
        colorConflict: false,
      });
      continue;
    }

    existing.columnIdByWorkspaceId[column.workspaceId] = column.id;
    // Lowest position wins, so a column early in either workspace stays early on the merged board.
    existing.position = Math.min(existing.position, column.position);
    // Terminal wins: a completed task must have somewhere to land.
    existing.isDone = existing.isDone || column.isDone;
    if (existing.color !== column.color) existing.colorConflict = true;
  }

  return [...byKey.values()]
    .map(({ colorConflict, ...merged }) => ({ ...merged, color: colorConflict ? null : merged.color }))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** The real column id to write when a card from `workspaceId` is dropped on `column`. */
export function resolveDropTarget(column: MergedColumn, workspaceId: string): string | null {
  return column.columnIdByWorkspaceId[workspaceId] ?? null;
}

/**
 * Buckets tasks under merged columns, keyed the same way `mergeColumns` keys them.
 *
 * Completion is derived, not stored twice: a completed task renders in the terminal column
 * regardless of its board_column_id, so completing a task from the list view moves its card here
 * with no write. With no terminal column on the board, completed tasks simply do not appear.
 */
export function groupTasks(
  merged: MergedColumn[],
  tasks: BoardTask[],
  now: Date = new Date()
): Record<string, BoardTask[]> {
  const grouped: Record<string, BoardTask[]> = {};
  merged.forEach((column) => (grouped[column.key] = []));

  const keyByColumnId = new Map<string, string>();
  merged.forEach((column) =>
    Object.values(column.columnIdByWorkspaceId).forEach((id) => keyByColumnId.set(id, column.key))
  );

  const terminal = merged.find((column) => column.isDone);
  const windowStart = now.getTime() - DONE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  for (const task of tasks) {
    if (task.completedAt) {
      if (!terminal) continue;
      if (new Date(task.completedAt).getTime() < windowStart) continue;
      grouped[terminal.key].push(task);
      continue;
    }

    const key = keyByColumnId.get(task.boardColumnId);
    // A column deleted between the fetch and this render: the card is left out rather than invented
    // into a column the user did not choose. The next load places it properly.
    if (!key) continue;
    grouped[key].push(task);
  }

  for (const column of merged) {
    grouped[column.key].sort((a, b) =>
      column.isDone
        ? // Done reads as a history: most recently finished first.
          new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime()
        : a.memberSortKey - b.memberSortKey
    );
  }

  return grouped;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx jest src/app/board/group-columns.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Extract `deadlineFor` so the board reuses the deadline rules**

The board card needs the same red/yellow/green rules `/tasks` uses. Restating them would let the two
views drift, so lift them out of `bucketTasks`. In `src/app/tasks/bucket-tasks.ts`, add above
`bucketTasks`:

```ts
/**
 * The deadline pill's text and colour, per docs/product.md: red overdue, yellow due today, green
 * with time remaining, and green when there is no deadline at all.
 *
 * Extracted from bucketTasks so the board can use the same rules rather than a second copy of them.
 * bucketTasks still owns which *bucket* a task lands in; only the label and variant live here.
 */
export function deadlineFor(
  dueAt: string | null,
  now: Date
): { label: string | null; variant: "red" | "yellow" | "green" | null } {
  if (!dueAt) return { label: null, variant: null };

  const todayStr = toDateStr(now);
  const dueStr = toDateStr(new Date(dueAt));

  if (dueStr < todayStr) return { label: "Overdue", variant: "red" };
  if (dueStr === todayStr) return { label: "Due today", variant: "yellow" };

  const todayMidnight = new Date(`${todayStr}T00:00:00Z`);
  const dueMidnight = new Date(`${dueStr}T00:00:00Z`);
  const days = Math.round((dueMidnight.getTime() - todayMidnight.getTime()) / (24 * 60 * 60 * 1000));

  return { label: `Due in ${days} day${days !== 1 ? "s" : ""}`, variant: "green" };
}
```

Then rewrite the dated branch of `bucketTasks` to call it, keeping the bucket assignment where it is:

```ts
    const { label, variant } = deadlineFor(raw.due_at, now);
    t.deadlineLabel = label;
    t.deadlineVariant = variant;

    if (variant === "red") buckets.overdue.push(t);
    else if (variant === "yellow") buckets.today.push(t);
    else buckets.upcoming.push(t);
```

- [ ] **Step 6: Confirm the existing bucket tests still pass unchanged**

Run: `npx jest src/app/tasks/bucket-tasks.test.ts`
Expected: PASS with no edits to the test file. This is a refactor — if a test needed changing, the
behaviour moved and the extraction is wrong.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/app/board/group-columns.ts src/app/board/group-columns.test.ts src/app/tasks/bucket-tasks.ts
git commit -m "feat(board): add pure column grouping and share the deadline rules

mergeColumns/groupTasks/resolveDropTarget hold every arrangement rule —
merge by lower(name), lowest position wins, terminal wins, completion
beats board_column_id, seven-day done window — as pure functions, so they
are testable without a database or a DOM.

deadlineFor is lifted out of bucketTasks rather than restated, so the
board and the list view cannot drift about what counts as overdue."
```

---

### Task 9: The board card

**Files:**
- Create: `src/app/board/board-card.tsx`
- Test: `src/app/board/board-card.test.tsx`

**Interfaces:**
- Consumes: `BoardTask` (Task 8); `deadlineFor` from `src/app/tasks/bucket-tasks.ts`.
- Produces: `<BoardCard task={BoardTask} showWorkspace={boolean} now?: Date />`.

Before writing this component, invoke the `ui-ux-pro-max` skill for the visual pass — that is a
standing preference for new UI, and the card sets the board's visual language.

- [ ] **Step 1: Write the failing tests**

Create `src/app/board/board-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

import { BoardCard } from "./board-card";
import type { BoardTask } from "./group-columns";

const NOW = new Date("2026-08-28T12:00:00.000Z");

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    title: "Call the plumber",
    dueAt: null,
    completedAt: null,
    workspaceId: "a0000000-0000-4000-8000-000000000001",
    workspaceName: "Household",
    workspaceKind: "household",
    boardColumnId: "e0000000-0000-4000-8000-00000000000a",
    memberSortKey: 1000,
    assigneeCount: 1,
    ...overrides,
  };
}

it("shows the title, and nothing the board deliberately omits", () => {
  render(<BoardCard task={task()} showWorkspace now={NOW} />);

  expect(screen.getByText("Call the plumber")).toBeInTheDocument();
  expect(screen.getByText("Household")).toBeInTheDocument();
  expect(screen.getByText("No due date")).toBeInTheDocument();
});

it("marks an overdue deadline red and names it", () => {
  render(<BoardCard task={task({ dueAt: "2026-08-20T00:00:00.000Z" })} showWorkspace now={NOW} />);

  const pill = screen.getByText("Overdue");
  expect(pill).toHaveAttribute("data-variant", "red");
});

it("marks a deadline due today yellow", () => {
  render(<BoardCard task={task({ dueAt: "2026-08-28T00:00:00.000Z" })} showWorkspace now={NOW} />);

  expect(screen.getByText("Due today")).toHaveAttribute("data-variant", "yellow");
});

it("marks a deadline with time remaining green", () => {
  render(<BoardCard task={task({ dueAt: "2026-09-04T00:00:00.000Z" })} showWorkspace now={NOW} />);

  expect(screen.getByText("Due in 7 days")).toHaveAttribute("data-variant", "green");
});

it("treats a task with no deadline as green, per docs/product.md", () => {
  render(<BoardCard task={task()} showWorkspace now={NOW} />);

  expect(screen.getByText("No due date")).toHaveAttribute("data-variant", "green");
});

it("shows a shared badge only when more than one person is assigned", () => {
  const { rerender } = render(<BoardCard task={task({ assigneeCount: 1 })} showWorkspace now={NOW} />);
  expect(screen.queryByLabelText(/shared with/i)).not.toBeInTheDocument();

  rerender(<BoardCard task={task({ assigneeCount: 3 })} showWorkspace now={NOW} />);
  expect(screen.getByLabelText("Shared with 2 other people")).toBeInTheDocument();
});

it("hides the workspace chip when the board is scoped to one workspace", () => {
  render(<BoardCard task={task()} showWorkspace={false} now={NOW} />);

  expect(screen.queryByText("Household")).not.toBeInTheDocument();
});

it("reads a completed card as completed", () => {
  render(
    <BoardCard task={task({ completedAt: "2026-08-27T09:00:00.000Z" })} showWorkspace now={NOW} />
  );

  expect(screen.getByText("Completed")).toBeInTheDocument();
});

it("has no accessibility violations", async () => {
  const { container } = render(
    <BoardCard task={task({ dueAt: "2026-08-20T00:00:00.000Z", assigneeCount: 2 })} showWorkspace now={NOW} />
  );

  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/app/board/board-card.test.tsx`
Expected: FAIL — `Cannot find module './board-card'`.

- [ ] **Step 3: Write the card**

Create `src/app/board/board-card.tsx`:

```tsx
"use client";

import { deadlineFor } from "@/app/tasks/bucket-tasks";
import type { BoardTask } from "./group-columns";

/**
 * Deliberately thin: title, deadline, workspace, and a shared badge. Descriptions, subtasks and
 * updates are the list view's job — the board is for seeing where work stands at a glance, and a
 * card that carries everything defeats that.
 *
 * The column supplies its own tab20 colour as a rail and header tint; the card body stays on
 * --color-surface so the deadline stays the loudest signal on it.
 */
const VARIANT_CLASS = {
  red: "bg-[var(--color-danger-surface)] text-[var(--color-danger-text)]",
  yellow: "bg-[var(--color-warning-surface)] text-[var(--color-warning-text)]",
  green: "bg-[var(--color-success-surface)] text-[var(--color-success-text)]",
} as const;

const KIND_CLASS: Record<string, string> = {
  household:
    "bg-[var(--color-kind-household-surface)] text-[var(--color-kind-household-text)]",
  work: "bg-[var(--color-kind-work-surface)] text-[var(--color-kind-work-text)]",
};

export function BoardCard({
  task,
  showWorkspace,
  now = new Date(),
}: {
  task: BoardTask;
  showWorkspace: boolean;
  now?: Date;
}) {
  const { label, variant } = deadlineFor(task.dueAt, now);

  // docs/product.md: a task with no deadline appears green, and a completed one neutral.
  const pillLabel = task.completedAt ? "Completed" : (label ?? "No due date");
  const pillVariant = task.completedAt ? null : (variant ?? "green");

  return (
    <article className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
      <h3
        className={`truncate text-sm font-medium ${
          task.completedAt
            ? "text-[var(--color-text-muted)] line-through"
            : "text-[var(--color-text-primary)]"
        }`}
        title={task.title}
      >
        {task.title}
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          data-variant={pillVariant ?? undefined}
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            pillVariant
              ? VARIANT_CLASS[pillVariant]
              : "bg-[var(--color-surface-sunken)] text-[var(--color-text-muted)]"
          }`}
        >
          {pillLabel}
        </span>

        {showWorkspace && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              KIND_CLASS[task.workspaceKind] ??
              "bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]"
            }`}
          >
            {task.workspaceName}
          </span>
        )}

        {task.assigneeCount > 1 && (
          <span
            aria-label={`Shared with ${task.assigneeCount - 1} other ${
              task.assigneeCount - 1 === 1 ? "person" : "people"
            }`}
            className="inline-flex items-center rounded-full bg-[var(--color-accent-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--color-accent-text)]"
          >
            +{task.assigneeCount - 1}
          </span>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx jest src/app/board/board-card.test.tsx`
Expected: PASS, 9 tests including the axe check.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/app/board/board-card.tsx src/app/board/board-card.test.tsx
git commit -m "feat(board): add the board card

Title, deadline, workspace, shared badge — nothing else. The card body
stays on --color-surface so the deadline pill remains the loudest signal
on it, leaving the column's tab20 colour to group rather than compete.

Deadline text and colour come from deadlineFor, shared with the list
view, so the two cannot disagree about what is overdue."
```

---

### Task 10: The board page, drag-and-drop, and the expandable done column

**Files:**
- Create: `src/app/board/page.tsx`
- Create: `src/app/board/board-client.tsx`
- Create: `src/app/board/loading.tsx`
- Create: `src/app/board/error.tsx`
- Test: `src/app/board/board-client.test.tsx`
- Modify: `src/components/nav-links.tsx`

**Interfaces:**
- Consumes: `mergeColumns`, `groupTasks`, `resolveDropTarget`, `BoardColumn`, `BoardTask` (Task 8); `BoardCard` (Task 9); `moveTaskToColumn`, `loadOlderDone` (Task 6); `computeNeighborKeys` from `src/app/tasks/reorder-helpers.ts`; `toast` from `src/components/toaster.tsx`.
- Produces: route `/board`; `<BoardClient columns={BoardColumn[]} tasks={BoardTask[]} memberIdByWorkspaceId={Record<string,string>} workspaceIds={string[]} showWorkspace={boolean} />`; exported `buildBoardDragEndHandler(...)` for direct testing, mirroring `buildDragEndHandler` in `src/app/tasks/tasks-page-client.tsx`.

- [ ] **Step 1: Write the failing tests for the drop handler**

Create `src/app/board/board-client.test.tsx`:

```tsx
jest.mock("./move-actions", () => ({ moveTaskToColumn: jest.fn(), loadOlderDone: jest.fn() }));

import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { DropResult } from "@hello-pangea/dnd";

import { BoardClient, buildBoardDragEndHandler } from "./board-client";
import { mergeColumns, type BoardColumn, type BoardTask } from "./group-columns";
import { moveTaskToColumn } from "./move-actions";

const WS_H = "a0000000-0000-4000-8000-000000000001";
const WS_W = "a0000000-0000-4000-8000-000000000002";
const M_H = "b0000000-0000-4000-8000-000000000001";
const COL_H_TODO = "e0000000-0000-4000-8000-00000000000a";
const COL_H_PROG = "e0000000-0000-4000-8000-00000000000b";
const T1 = "c0000000-0000-4000-8000-000000000001";

beforeEach(() => {
  jest.clearAllMocks();
  (moveTaskToColumn as jest.Mock).mockResolvedValue({ ok: true });
});

const columns: BoardColumn[] = [
  { id: COL_H_TODO, workspaceId: WS_H, name: "Not Started", color: "tab20-grey", position: 1000, isDone: false },
  { id: COL_H_PROG, workspaceId: WS_H, name: "In Progress", color: "tab20-blue", position: 2000, isDone: false },
];

function task(overrides: Partial<BoardTask> & { id: string; boardColumnId: string }): BoardTask {
  return {
    title: "Call the plumber",
    dueAt: null,
    completedAt: null,
    workspaceId: WS_H,
    workspaceName: "Household",
    workspaceKind: "household",
    memberSortKey: 1000,
    assigneeCount: 1,
    ...overrides,
  };
}

function handler(overrides: Partial<Parameters<typeof buildBoardDragEndHandler>[0]> = {}) {
  return buildBoardDragEndHandler({
    merged: mergeColumns(columns),
    groupedByKey: {
      "not started": [task({ id: T1, boardColumnId: COL_H_TODO })],
      "in progress": [],
    },
    memberIdByWorkspaceId: { [WS_H]: M_H },
    setLocalTasks: jest.fn(),
    onError: jest.fn(),
    ...overrides,
  });
}

const drop = (over: Partial<DropResult>): DropResult =>
  ({
    draggableId: T1,
    source: { droppableId: "not started", index: 0 },
    destination: { droppableId: "in progress", index: 0 },
    reason: "DROP",
    mode: "FLUID",
    type: "DEFAULT",
    combine: null,
    ...over,
  }) as DropResult;

it("sends the resolved column id for the card's own workspace", async () => {
  await handler()(drop({}));

  expect(moveTaskToColumn).toHaveBeenCalledWith({
    taskId: T1,
    columnId: COL_H_PROG,
    memberId: M_H,
    prevKey: null,
    nextKey: null,
  });
});

it("does nothing when the card is dropped outside a column", async () => {
  await handler()(drop({ destination: null }));

  expect(moveTaskToColumn).not.toHaveBeenCalled();
});

it("does nothing when the card is dropped exactly where it started", async () => {
  await handler()(drop({ destination: { droppableId: "not started", index: 0 } }));

  expect(moveTaskToColumn).not.toHaveBeenCalled();
});

it("computes neighbour keys from the destination column's rendered order", async () => {
  const call = handler({
    groupedByKey: {
      "not started": [task({ id: T1, boardColumnId: COL_H_TODO })],
      "in progress": [
        task({ id: "c0000000-0000-4000-8000-000000000002", boardColumnId: COL_H_PROG, memberSortKey: 2000 }),
        task({ id: "c0000000-0000-4000-8000-000000000003", boardColumnId: COL_H_PROG, memberSortKey: 4000 }),
      ],
    },
  });

  await call(drop({ destination: { droppableId: "in progress", index: 1 } }));

  expect(moveTaskToColumn).toHaveBeenCalledWith(
    expect.objectContaining({ prevKey: 2000, nextKey: 4000 })
  );
});

it("refuses a drop into a column the card's workspace does not have, and says why", async () => {
  const onError = jest.fn();
  const crossWorkspace: BoardColumn[] = [
    ...columns,
    { id: "e0000000-0000-4000-8000-00000000000f", workspaceId: WS_W, name: "Waiting on legal", color: "tab20-cyan", position: 3000, isDone: false },
  ];

  const call = buildBoardDragEndHandler({
    merged: mergeColumns(crossWorkspace),
    groupedByKey: {
      "not started": [task({ id: T1, boardColumnId: COL_H_TODO })],
      "in progress": [],
      "waiting on legal": [],
    },
    memberIdByWorkspaceId: { [WS_H]: M_H },
    setLocalTasks: jest.fn(),
    onError,
  });

  await call(drop({ destination: { droppableId: "waiting on legal", index: 0 } }));

  expect(moveTaskToColumn).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith('Household has no "Waiting on legal" column');
});

it("moves the card optimistically and rolls back when the server refuses", async () => {
  (moveTaskToColumn as jest.Mock).mockResolvedValue({ ok: false, error: "Nope" });
  const setLocalTasks = jest.fn();
  const onError = jest.fn();

  await handler({ setLocalTasks, onError })(drop({}));

  // Once to move it, once to put it back.
  expect(setLocalTasks).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledWith("Nope");

  const applyFirst = setLocalTasks.mock.calls[0][0] as (prev: BoardTask[]) => BoardTask[];
  expect(applyFirst([task({ id: T1, boardColumnId: COL_H_TODO })])[0].boardColumnId).toBe(COL_H_PROG);

  const applyRollback = setLocalTasks.mock.calls[1][0] as (prev: BoardTask[]) => BoardTask[];
  expect(applyRollback([task({ id: T1, boardColumnId: COL_H_PROG })])[0].boardColumnId).toBe(COL_H_TODO);
});

it("renders one region per column, labelled with its task count", () => {
  render(
    <BoardClient
      columns={columns}
      tasks={[task({ id: T1, boardColumnId: COL_H_TODO })]}
      memberIdByWorkspaceId={{ [WS_H]: M_H }}
      workspaceIds={[WS_H]}
      showWorkspace={false}
    />
  );

  expect(screen.getByRole("region", { name: "Not Started, 1 task" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "In Progress, 0 tasks" })).toBeInTheDocument();
});

it("has no accessibility violations", async () => {
  const { container } = render(
    <BoardClient
      columns={columns}
      tasks={[task({ id: T1, boardColumnId: COL_H_TODO })]}
      memberIdByWorkspaceId={{ [WS_H]: M_H }}
      workspaceIds={[WS_H]}
      showWorkspace={false}
    />
  );

  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/app/board/board-client.test.tsx`
Expected: FAIL — `Cannot find module './board-client'`.

- [ ] **Step 3: Write the client component**

Create `src/app/board/board-client.tsx`. The drop handler is exported separately for the same reason
`buildDragEndHandler` is in `tasks-page-client.tsx`: the library's sensors are not driveable from
synthetic DOM events, so the handler is tested by calling it with a fabricated `DropResult`.

```tsx
"use client";

import { useMemo, useState } from "react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";

import { computeNeighborKeys } from "@/app/tasks/reorder-helpers";
import { toast } from "@/components/toaster";
import { BoardCard } from "./board-card";
import {
  DONE_WINDOW_DAYS,
  groupTasks,
  mergeColumns,
  resolveDropTarget,
  type BoardColumn,
  type BoardTask,
  type MergedColumn,
} from "./group-columns";
import { loadOlderDone, moveTaskToColumn } from "./move-actions";

/**
 * Applies a drop.
 *
 * Exported and built as a factory so tests can call it with a fabricated DropResult:
 * @hello-pangea/dnd's sensors are not designed to be driven by synthetic DOM events, which is the
 * same reason tasks-page-client.tsx exports buildDragEndHandler.
 */
export function buildBoardDragEndHandler({
  merged,
  groupedByKey,
  memberIdByWorkspaceId,
  setLocalTasks,
  onError,
}: {
  merged: MergedColumn[];
  /** The *rendered* arrays: destination.index is an index into what the user can see. */
  groupedByKey: Record<string, BoardTask[]>;
  memberIdByWorkspaceId: Record<string, string>;
  setLocalTasks: (updater: (prev: BoardTask[]) => BoardTask[]) => void;
  onError: (message: string) => void;
}) {
  return async function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const dragged = groupedByKey[source.droppableId]?.find((t) => t.id === draggableId);
    if (!dragged) return;

    const targetColumn = merged.find((c) => c.key === destination.droppableId);
    if (!targetColumn) return;

    // On the all-workspaces board a column may be merged from several workspaces' columns. The card
    // must land in its own workspace's column, and if that workspace has no column by this name the
    // drop is refused rather than inventing one.
    const columnId = resolveDropTarget(targetColumn, dragged.workspaceId);
    if (!columnId) {
      onError(`${dragged.workspaceName} has no "${targetColumn.name}" column`);
      return;
    }

    const memberId = memberIdByWorkspaceId[dragged.workspaceId];
    if (!memberId) {
      onError("Could not determine your membership for this task's workspace");
      return;
    }

    const withoutDragged = (groupedByKey[destination.droppableId] ?? []).filter(
      (t) => t.id !== draggableId
    );
    const reordered = [
      ...withoutDragged.slice(0, destination.index),
      dragged,
      ...withoutDragged.slice(destination.index),
    ];
    const { prevKey, nextKey } = computeNeighborKeys(
      reordered.map((t) => ({ member_sort_key: t.memberSortKey })),
      destination.index
    );

    // Must stay in sync with move_task_to_column's arithmetic in migration 016 and with reorderTask:
    // all three compute the same key, one optimistically and two authoritatively.
    const optimisticKey =
      prevKey !== null && nextKey !== null
        ? (prevKey + nextKey) / 2
        : prevKey !== null
          ? prevKey + 1000
          : nextKey !== null
            ? nextKey - 1000
            : dragged.memberSortKey;

    setLocalTasks((prev) =>
      prev.map((t) =>
        t.id === draggableId
          ? { ...t, boardColumnId: columnId, memberSortKey: optimisticKey }
          : t
      )
    );

    const res = await moveTaskToColumn({ taskId: draggableId, columnId, memberId, prevKey, nextKey });

    if (!res.ok) {
      // Roll back this card only. Replacing the whole array would erase anything else that moved
      // during the await.
      setLocalTasks((prev) =>
        prev.map((t) =>
          t.id === draggableId
            ? { ...t, boardColumnId: dragged.boardColumnId, memberSortKey: dragged.memberSortKey }
            : t
        )
      );
      onError(res.error ?? "Failed to move task");
    }
  };
}

export function BoardClient({
  columns,
  tasks,
  memberIdByWorkspaceId,
  workspaceIds,
  showWorkspace,
}: {
  columns: BoardColumn[];
  tasks: BoardTask[];
  memberIdByWorkspaceId: Record<string, string>;
  workspaceIds: string[];
  showWorkspace: boolean;
}) {
  const [localTasks, setLocalTasks] = useState(tasks);
  /** Older completed tasks the user asked for. Client state: a fresh visit starts collapsed. */
  const [olderDone, setOlderDone] = useState<BoardTask[]>([]);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [moreOlder, setMoreOlder] = useState(true);

  const merged = useMemo(() => mergeColumns(columns), [columns]);
  const groupedByKey = useMemo(() => {
    const grouped = groupTasks(merged, localTasks);
    const terminal = merged.find((c) => c.isDone);
    if (terminal && doneExpanded) {
      grouped[terminal.key] = [...grouped[terminal.key], ...olderDone];
    }
    return grouped;
  }, [merged, localTasks, doneExpanded, olderDone]);

  const onDragEnd = buildBoardDragEndHandler({
    merged,
    groupedByKey,
    memberIdByWorkspaceId,
    setLocalTasks,
    onError: (message) => toast(message, "error"),
  });

  async function showOlder() {
    const terminal = merged.find((c) => c.isDone);
    if (!terminal) return;

    const shown = groupedByKey[terminal.key];
    const oldest = shown.reduce<string | null>(
      (acc, t) => (t.completedAt && (acc === null || t.completedAt < acc) ? t.completedAt : acc),
      null
    );

    setLoadingOlder(true);
    const res = await loadOlderDone({
      workspaceIds,
      before: oldest ?? new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000).toISOString(),
    });
    setLoadingOlder(false);

    if (!res.ok) {
      toast(res.error ?? "Could not load older tasks", "error");
      return;
    }

    // The older page carries no workspace names — they come from the columns already on screen.
    const nameByWorkspaceId = new Map(localTasks.map((t) => [t.workspaceId, t]));
    setOlderDone((prev) => [
      ...prev,
      ...res.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt,
        completedAt: t.completedAt,
        workspaceId: t.workspaceId,
        workspaceName: nameByWorkspaceId.get(t.workspaceId)?.workspaceName ?? "",
        workspaceKind: nameByWorkspaceId.get(t.workspaceId)?.workspaceKind ?? "",
        boardColumnId: t.boardColumnId,
        memberSortKey: t.memberSortKey,
        assigneeCount: 1,
      })),
    ]);
    setMoreOlder(res.hasMore);
    setDoneExpanded(true);
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto p-4">
        {merged.map((column) => {
          const items = groupedByKey[column.key] ?? [];
          const accent = column.color ? `var(--color-${column.color})` : "var(--color-border)";

          return (
            <section
              key={column.key}
              aria-label={`${column.name}, ${items.length} task${items.length === 1 ? "" : "s"}`}
              className="flex w-[280px] shrink-0 flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]"
            >
              <header
                className="sticky top-0 rounded-t-lg border-b border-[var(--color-border)] px-3 py-2"
                style={{
                  borderTop: `3px solid ${accent}`,
                  background: `color-mix(in oklab, ${accent} 14%, var(--color-surface))`,
                }}
              >
                <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                  {column.name}
                </h2>
                <p className="text-xs text-[var(--color-text-secondary)]">{items.length}</p>
              </header>

              <Droppable droppableId={column.key}>
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex flex-1 flex-col gap-2 p-2 ${
                      column.isDone && doneExpanded ? "max-h-[60dvh] overflow-y-auto" : ""
                    }`}
                  >
                    {items.map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(dragProvided) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                          >
                            <BoardCard task={task} showWorkspace={showWorkspace} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>

              {column.isDone && (
                <button
                  type="button"
                  onClick={showOlder}
                  disabled={loadingOlder || (doneExpanded && !moreOlder)}
                  className="min-h-11 rounded-b-lg border-t border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)] disabled:opacity-60"
                >
                  {loadingOlder
                    ? "Loading…"
                    : doneExpanded && !moreOlder
                      ? "No older tasks"
                      : doneExpanded
                        ? "Show more"
                        : "Show older"}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </DragDropContext>
  );
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx jest src/app/board/board-client.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the server component**

Create `src/app/board/page.tsx`. The fetch shape follows `src/app/tasks/page.tsx`: RLS decides what
comes back, and the id filters shape the result rather than guard it.

```tsx
import { createClient } from "@/lib/supabase/server";
import { BoardClient } from "./board-client";
import type { BoardColumn, BoardTask } from "./group-columns";
import type { Tab20Slug } from "./colors";
import { DONE_WINDOW_DAYS } from "./group-columns";

type SearchParams = Promise<{ workspace?: string }>;

export default async function BoardPage({ searchParams }: { searchParams: SearchParams }) {
  const { workspace: workspaceFilter } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: myMembers } = user
    ? await supabase
        .from("workspace_members")
        .select("id, workspace_id")
        .eq("auth_user_id", user.id)
    : { data: [] };

  const allMyWorkspaceIds = (myMembers ?? []).map((m) => m.workspace_id as string);
  const workspaceIds = workspaceFilter
    ? allMyWorkspaceIds.filter((id) => id === workspaceFilter)
    : allMyWorkspaceIds;

  if (workspaceIds.length === 0) {
    return (
      <main className="p-6">
        <h1 className="mb-2 text-xl font-semibold tracking-tight">Board</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Join or create a workspace to use the board.
        </p>
      </main>
    );
  }

  const memberIdByWorkspaceId: Record<string, string> = {};
  (myMembers ?? []).forEach((m) => {
    memberIdByWorkspaceId[m.workspace_id as string] = m.id as string;
  });

  const { data: workspaceRows } = await supabase
    .from("workspaces")
    .select("id, name, kind")
    .in("id", workspaceIds);

  const workspaceById = new Map(
    (workspaceRows ?? []).map((w) => [w.id as string, { name: w.name as string, kind: w.kind as string }])
  );

  const { data: columnRows } = await supabase
    .from("board_columns")
    .select("id, workspace_id, name, color, position, is_done")
    .in("workspace_id", workspaceIds)
    .order("position", { ascending: true });

  const columns: BoardColumn[] = (columnRows ?? []).map((c) => ({
    id: c.id as string,
    workspaceId: c.workspace_id as string,
    name: c.name as string,
    color: c.color as Tab20Slug,
    position: c.position as number,
    isDone: c.is_done as boolean,
  }));

  // Visibility is assignment, and ordering is per user, so the caller's assignment rows come first.
  const myMemberIds = (myMembers ?? []).map((m) => m.id as string);
  const { data: myAssignments } = await supabase
    .from("task_assignments")
    .select("task_id, member_sort_key")
    .in("member_id", myMemberIds);

  const sortKeyByTaskId = new Map(
    (myAssignments ?? []).map((a) => [a.task_id as string, a.member_sort_key as number])
  );
  const myTaskIds = [...sortKeyByTaskId.keys()];

  // Completed work older than the done window is fetched on demand by loadOlderDone, so the initial
  // query stays bounded however long the history is.
  const doneCutoff = new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000).toISOString();

  const { data: taskRows } = myTaskIds.length
    ? await supabase
        .from("tasks")
        .select("id, title, due_at, completed_at, workspace_id, board_column_id")
        .in("id", myTaskIds)
        .in("workspace_id", workspaceIds)
        .is("parent_task_id", null)
        .or(`completed_at.is.null,completed_at.gte.${doneCutoff}`)
    : { data: [] };

  const { data: allAssignments } = myTaskIds.length
    ? await supabase.from("task_assignments").select("task_id, member_id").in("task_id", myTaskIds)
    : { data: [] };

  const assigneeCounts = new Map<string, number>();
  (allAssignments ?? []).forEach((a) => {
    const id = a.task_id as string;
    assigneeCounts.set(id, (assigneeCounts.get(id) ?? 0) + 1);
  });

  const tasks: BoardTask[] = (taskRows ?? []).map((t) => {
    const workspaceId = t.workspace_id as string;
    const workspace = workspaceById.get(workspaceId);
    return {
      id: t.id as string,
      title: t.title as string,
      dueAt: (t.due_at as string | null) ?? null,
      completedAt: (t.completed_at as string | null) ?? null,
      workspaceId,
      workspaceName: workspace?.name ?? "",
      workspaceKind: workspace?.kind ?? "",
      boardColumnId: t.board_column_id as string,
      memberSortKey: sortKeyByTaskId.get(t.id as string) ?? 0,
      assigneeCount: assigneeCounts.get(t.id as string) ?? 1,
    };
  });

  return (
    <main>
      <h1 className="px-4 pt-6 text-xl font-semibold tracking-tight">Board</h1>
      <BoardClient
        columns={columns}
        tasks={tasks}
        memberIdByWorkspaceId={memberIdByWorkspaceId}
        workspaceIds={workspaceIds}
        showWorkspace={workspaceIds.length > 1}
      />
    </main>
  );
}
```

- [ ] **Step 6: Add `loading.tsx` and `error.tsx`**

Copy the shape of `src/app/tasks/loading.tsx` and `src/app/tasks/error.tsx`, substituting the board's
layout: `loading.tsx` renders three 280px-wide skeleton columns with `aria-busy="true"` and an
`sr-only` "Loading your board…"; `error.tsx` is the `/tasks` error component with its copy changed to
"Could not load the board." and the same retry button wired to `reset()`.

- [ ] **Step 7: Add the nav link**

In `src/components/nav-links.tsx`, extend the `links` array:

```ts
const links = [
  { href: "/tasks", label: "Tasks" },
  { href: "/board", label: "Board" },
  { href: "/workspaces", label: "Workspaces" },
];
```

`/settings` is reached from the user menu, not this bar — Task 11 covers it.

- [ ] **Step 8: Verify the existing nav test still passes and see the board run**

Run: `npx jest src/components/__tests__ src/app/layout.test.tsx`
Expected: PASS.

```bash
npm run dev
```

Open `http://localhost:3000/board`. Confirm: five columns per the seeded defaults, cards showing
title/deadline/workspace only, a card dragged between columns stays there after a reload, and
dragging into Completed makes the task appear completed on `/tasks`.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck
git add src/app/board/page.tsx src/app/board/board-client.tsx src/app/board/board-client.test.tsx src/app/board/loading.tsx src/app/board/error.tsx src/components/nav-links.tsx
git commit -m "feat(board): add the /board view with drag and drop

The drop handler resolves a merged column to the card's own workspace and
refuses the drop when that workspace has no column by that name, rather
than inventing one. Optimistic moves roll back per card so a concurrent
change is not erased.

The initial query is bounded to the seven-day done window; older
completed work is paged in on demand and collapses again on the next
visit."
```

---

### Task 11: `/settings` with Profile and Board tabs

**Files:**
- Create: `src/app/settings/page.tsx`
- Create: `src/app/settings/profile-tab.tsx`
- Test: `src/app/settings/page.test.tsx`
- Modify: `src/app/profile/page.tsx` (becomes a redirect)
- Modify: `src/components/nav-user.tsx` (point the menu at `/settings`)

**Interfaces:**
- Consumes: `TabPill` from `src/app/tasks/tab-pill.tsx`.
- Produces: route `/settings` accepting `?tab=profile|board` (default `profile`); `<ProfileTab />`, the current `/profile` body verbatim; `/profile` permanently redirects to `/settings?tab=profile`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/settings/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

import SettingsPage from "./page";

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { email: "a@b.c", user_metadata: { name: "Alice" } } } }),
      updateUser: async () => ({ error: null }),
    },
  }),
}));

jest.mock("./board-tab", () => ({ BoardTab: () => <div>Board tab content</div> }));

let mockSearch = "";

async function renderPage(search: string) {
  mockSearch = search;
  return render(await SettingsPage({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) }));
}

it("shows both tabs", async () => {
  await renderPage("");

  expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Board" })).toBeInTheDocument();
});

it("defaults to the profile tab", async () => {
  await renderPage("");

  expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
  expect(screen.queryByText("Board tab content")).not.toBeInTheDocument();
});

it("shows the board tab when asked", async () => {
  await renderPage("tab=board");

  expect(screen.getByText("Board tab content")).toBeInTheDocument();
});

it("falls back to the profile tab for an unknown tab value", async () => {
  await renderPage("tab=nonsense");

  expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
});

it("has no accessibility violations", async () => {
  const { container } = await renderPage("");

  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/app/settings/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 3: Move the profile body into a tab component**

Create `src/app/settings/profile-tab.tsx` containing the current body of `src/app/profile/page.tsx`
verbatim — the same `"use client"`, the same imports, the same skeleton and form — renamed from
`ProfilePage` to `ProfileTab` and with its outer `<main className="max-w-sm p-6">` changed to
`<div className="max-w-sm">`, since the tab shell now owns the page element and its padding.

- [ ] **Step 4: Write the settings shell**

Create `src/app/settings/page.tsx`:

```tsx
import { TabPill } from "@/app/tasks/tab-pill";
import { BoardTab } from "./board-tab";
import { ProfileTab } from "./profile-tab";

type SearchParams = Promise<{ tab?: string }>;

/**
 * Per-user settings, tabbed so this stays the one place settings live rather than growing a route
 * each time something is configurable. /profile redirects here.
 */
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { tab } = await searchParams;
  // Anything unrecognised falls back rather than rendering nothing: the tab comes from the URL.
  const active = tab === "board" ? "board" : "profile";

  return (
    <main className="p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Settings</h1>

      <nav aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto">
        <TabPill href="/settings?tab=profile" label="Profile" matchKey="tab" matchValue="profile" />
        <TabPill href="/settings?tab=board" label="Board" matchKey="tab" matchValue="board" />
      </nav>

      {active === "board" ? <BoardTab /> : <ProfileTab />}
    </main>
  );
}
```

`TabPill` treats a missing `tab` param as inactive for both pills, which is why the Profile link
carries `?tab=profile` explicitly rather than pointing at bare `/settings`.

- [ ] **Step 5: Turn `/profile` into a redirect**

Replace the whole of `src/app/profile/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

/**
 * The profile form moved into /settings when board columns needed a settings home. Kept as a
 * redirect rather than deleted: this path is in bookmarks, and the user menu linked here for months.
 */
export default function ProfilePage() {
  redirect("/settings?tab=profile");
}
```

- [ ] **Step 6: Point the user menu at settings**

In `src/components/nav-user.tsx`, change the profile link's `href` from `/profile` to
`/settings?tab=profile` and its label from "Profile" to "Settings". Update the corresponding
assertion in `src/components/__tests__` if one names that label.

- [ ] **Step 7: Run the suite for the touched areas**

Run: `npx jest src/app/settings src/components/__tests__`
Expected: PASS. `BoardTab` is mocked in this task's test; Task 12 implements it, so create a minimal
placeholder file first if the import fails:

```tsx
// src/app/settings/board-tab.tsx — replaced wholesale in Task 12.
export function BoardTab() {
  return null;
}
```

- [ ] **Step 8: Commit**

```bash
npm run typecheck
git add src/app/settings src/app/profile/page.tsx src/components/nav-user.tsx
git commit -m "feat(settings): add a tabbed /settings route

The profile form moves in as the first tab so per-user settings have one
home rather than a route each. /profile stays as a redirect because it is
in bookmarks and the user menu pointed there."
```

---

### Task 12: The Board settings tab — column editor

**Files:**
- Create: `src/app/settings/board-tab.tsx` (replaces the placeholder)
- Create: `src/app/settings/column-row.tsx`
- Create: `src/app/settings/color-picker.tsx`
- Test: `src/app/settings/column-row.test.tsx`
- Test: `src/app/settings/color-picker.test.tsx`

**Interfaces:**
- Consumes: `TAB20_SLUGS`, `Tab20Slug` (Task 1); `createBoardColumn`, `renameBoardColumn`, `setBoardColumnColor`, `reorderBoardColumn` (Task 5); `BoardColumn` (Task 8); `DeleteColumnDialog` (Task 13).
- Produces: `<BoardTab />` (server component: loads the user's workspaces and their columns, renders `<BoardColumnsEditor>` per workspace); `<ColumnRow column={BoardColumn} siblingCount={number} onDeleted={() => void} />`; `<ColorPicker value={Tab20Slug} onChange={(slug: Tab20Slug) => void} label={string} />`.

- [ ] **Step 1: Write the failing tests for the colour picker**

Create `src/app/settings/color-picker.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { TAB20_SLUGS } from "@/app/board/colors";
import { ColorPicker } from "./color-picker";

it("offers all twenty palette colours once opened", async () => {
  render(<ColorPicker value="tab20-blue" onChange={jest.fn()} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));

  expect(screen.getAllByRole("radio")).toHaveLength(TAB20_SLUGS.length);
});

it("marks the current colour as selected", async () => {
  render(<ColorPicker value="tab20-cyan" onChange={jest.fn()} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));

  expect(screen.getByRole("radio", { name: "tab20-cyan", checked: true })).toBeInTheDocument();
});

it("reports the chosen colour and closes", async () => {
  const onChange = jest.fn();
  render(<ColorPicker value="tab20-blue" onChange={onChange} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  await userEvent.click(screen.getByRole("radio", { name: "tab20-olive" }));

  expect(onChange).toHaveBeenCalledWith("tab20-olive");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});

it("closes on Escape without reporting a change", async () => {
  const onChange = jest.fn();
  render(<ColorPicker value="tab20-blue" onChange={onChange} label="Colour for In Progress" />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  await userEvent.keyboard("{Escape}");

  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it("has no accessibility violations when open", async () => {
  const { container } = render(
    <ColorPicker value="tab20-blue" onChange={jest.fn()} label="Colour for In Progress" />
  );
  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));

  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run to confirm failure, then write the picker**

Run: `npx jest src/app/settings/color-picker.test.tsx`
Expected: FAIL — `Cannot find module './color-picker'`.

Create `src/app/settings/color-picker.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { TAB20_SLUGS, type Tab20Slug } from "@/app/board/colors";

/**
 * The twenty tab20 swatches, as a radiogroup rather than a listbox: picking a colour is choosing
 * one of a fixed set, and radios give keyboard users arrow-key traversal for free.
 */
export function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: Tab20Slug;
  onChange: (slug: Tab20Slug) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="min-h-11 w-11 rounded-sm border border-[var(--color-border)] p-1"
      >
        <span
          className="block h-full w-full rounded-sm"
          style={{ background: `var(--color-${value})` }}
        />
      </button>

      {open && (
        <div
          role="radiogroup"
          aria-label={label}
          className="absolute z-10 mt-1 grid grid-cols-5 gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-xl"
        >
          {TAB20_SLUGS.map((slug) => (
            <button
              key={slug}
              type="button"
              role="radio"
              aria-label={slug}
              aria-checked={slug === value}
              onClick={() => {
                onChange(slug);
                setOpen(false);
              }}
              className={`h-9 w-9 rounded-sm border-2 ${
                slug === value ? "border-[var(--color-text-primary)]" : "border-transparent"
              }`}
              style={{ background: `var(--color-${slug})` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

Run: `npx jest src/app/settings/color-picker.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 3: Write the failing tests for a column row**

Create `src/app/settings/column-row.test.tsx`:

```tsx
jest.mock("@/app/board/actions", () => ({
  renameBoardColumn: jest.fn(),
  setBoardColumnColor: jest.fn(),
}));
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renameBoardColumn, setBoardColumnColor } from "@/app/board/actions";
import { toast } from "@/components/toaster";
import { ColumnRow } from "./column-row";
import type { BoardColumn } from "@/app/board/group-columns";

const column: BoardColumn = {
  id: "e0000000-0000-4000-8000-00000000000b",
  workspaceId: "a0000000-0000-4000-8000-000000000001",
  name: "In Progress",
  color: "tab20-blue",
  position: 2000,
  isDone: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  (renameBoardColumn as jest.Mock).mockResolvedValue({ ok: true });
  (setBoardColumnColor as jest.Mock).mockResolvedValue({ ok: true });
});

it("saves a rename on blur", async () => {
  render(<ColumnRow column={column} siblingCount={3} onDeleted={jest.fn()} />);

  const input = screen.getByLabelText("Column name");
  await userEvent.clear(input);
  await userEvent.type(input, "Doing");
  await userEvent.tab();

  expect(renameBoardColumn).toHaveBeenCalledWith({ columnId: column.id, name: "Doing" });
});

it("does not call the server when the name is unchanged", async () => {
  render(<ColumnRow column={column} siblingCount={3} onDeleted={jest.fn()} />);

  await userEvent.click(screen.getByLabelText("Column name"));
  await userEvent.tab();

  expect(renameBoardColumn).not.toHaveBeenCalled();
});

it("restores the previous name and says so when the rename fails", async () => {
  (renameBoardColumn as jest.Mock).mockResolvedValue({ ok: false, error: "Name already used" });
  render(<ColumnRow column={column} siblingCount={3} onDeleted={jest.fn()} />);

  const input = screen.getByLabelText("Column name");
  await userEvent.clear(input);
  await userEvent.type(input, "Blocked");
  await userEvent.tab();

  expect(toast).toHaveBeenCalledWith("Name already used", "error");
  expect(input).toHaveValue("In Progress");
});

it("saves a colour immediately", async () => {
  render(<ColumnRow column={column} siblingCount={3} onDeleted={jest.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  await userEvent.click(screen.getByRole("radio", { name: "tab20-pink" }));

  expect(setBoardColumnColor).toHaveBeenCalledWith({ columnId: column.id, color: "tab20-pink" });
});

it("says the column is where completed tasks go when it is terminal", () => {
  render(<ColumnRow column={{ ...column, isDone: true }} siblingCount={3} onDeleted={jest.fn()} />);

  expect(screen.getByText("Completed tasks land here")).toBeInTheDocument();
});

it("disables delete when it is the workspace's only column", () => {
  render(<ColumnRow column={column} siblingCount={1} onDeleted={jest.fn()} />);

  expect(screen.getByRole("button", { name: "Delete In Progress" })).toBeDisabled();
});
```

- [ ] **Step 4: Run to confirm failure, then write the row**

Run: `npx jest src/app/settings/column-row.test.tsx`
Expected: FAIL — `Cannot find module './column-row'`.

Create `src/app/settings/column-row.tsx`:

```tsx
"use client";

import { useState } from "react";

import { renameBoardColumn, setBoardColumnColor } from "@/app/board/actions";
import type { BoardColumn } from "@/app/board/group-columns";
import type { Tab20Slug } from "@/app/board/colors";
import { toast } from "@/components/toaster";
import { ColorPicker } from "./color-picker";
import { DeleteColumnDialog } from "./delete-column-dialog";

/**
 * One editable column. Rename saves on blur and colour saves on pick, both optimistically — neither
 * moves a task, so neither needs confirmation. Deletion does, and is handled by its own dialog.
 */
export function ColumnRow({
  column,
  siblingCount,
  onDeleted,
}: {
  column: BoardColumn;
  siblingCount: number;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(column.name);
  const [color, setColor] = useState<Tab20Slug>(column.color);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed === column.name) return;

    const result = await renameBoardColumn({ columnId: column.id, name: trimmed });
    if (!result.ok) {
      setName(column.name);
      toast(result.error ?? "Could not rename the column", "error");
    }
  }

  async function saveColor(slug: Tab20Slug) {
    const previous = color;
    setColor(slug);

    const result = await setBoardColumnColor({ columnId: column.id, color: slug });
    if (!result.ok) {
      setColor(previous);
      toast(result.error ?? "Could not change the colour", "error");
    }
  }

  return (
    <li className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <ColorPicker value={color} onChange={saveColor} label={`Colour for ${column.name}`} />

      <div className="flex min-w-0 flex-1 flex-col">
        <input
          aria-label="Column name"
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          onBlur={saveName}
          className="min-h-11 rounded-sm border border-transparent bg-transparent px-2 text-sm hover:border-[var(--color-border)] focus:border-[var(--color-focus)]"
        />
        {column.isDone && (
          <span className="px-2 text-xs text-[var(--color-text-secondary)]">
            Completed tasks land here
          </span>
        )}
      </div>

      <button
        type="button"
        aria-label={`Delete ${column.name}`}
        disabled={siblingCount <= 1}
        onClick={() => setConfirmingDelete(true)}
        className="min-h-11 rounded-sm px-3 text-sm text-[var(--color-danger-text)] hover:bg-[var(--color-danger-surface)] disabled:opacity-50"
      >
        Delete
      </button>

      {confirmingDelete && (
        <DeleteColumnDialog
          column={column}
          onClose={() => setConfirmingDelete(false)}
          onDeleted={() => {
            setConfirmingDelete(false);
            onDeleted();
          }}
        />
      )}
    </li>
  );
}
```

Run: `npx jest src/app/settings/column-row.test.tsx`
Expected: PASS, 6 tests. `DeleteColumnDialog` arrives in Task 13; until then add the placeholder
`export function DeleteColumnDialog() { return null; }` in
`src/app/settings/delete-column-dialog.tsx` so this compiles.

- [ ] **Step 5: Write the tab shell**

Create `src/app/settings/board-tab.tsx`, replacing the placeholder. It is a server component that
loads the user's workspaces and their columns, and delegates each workspace to a small client editor
that owns the add-column form and the reorder drag:

```tsx
import { createClient } from "@/lib/supabase/server";
import type { Tab20Slug } from "@/app/board/colors";
import type { BoardColumn } from "@/app/board/group-columns";
import { BoardColumnsEditor } from "./board-columns-editor";

/**
 * Columns are shared by a workspace's members, so this tab edits shared data. Every workspace the
 * user belongs to gets its own list, and the copy says plainly who else a change reaches.
 */
export async function BoardTab() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: myMembers } = user
    ? await supabase.from("workspace_members").select("workspace_id").eq("auth_user_id", user.id)
    : { data: [] };

  const workspaceIds = (myMembers ?? []).map((m) => m.workspace_id as string);

  if (workspaceIds.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        Join or create a workspace to configure board columns.
      </p>
    );
  }

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name")
    .in("id", workspaceIds)
    .order("name", { ascending: true });

  const { data: columnRows } = await supabase
    .from("board_columns")
    .select("id, workspace_id, name, color, position, is_done")
    .in("workspace_id", workspaceIds)
    .order("position", { ascending: true });

  const columnsByWorkspace = new Map<string, BoardColumn[]>();
  (columnRows ?? []).forEach((c) => {
    const workspaceId = c.workspace_id as string;
    const list = columnsByWorkspace.get(workspaceId) ?? [];
    list.push({
      id: c.id as string,
      workspaceId,
      name: c.name as string,
      color: c.color as Tab20Slug,
      position: c.position as number,
      isDone: c.is_done as boolean,
    });
    columnsByWorkspace.set(workspaceId, list);
  });

  return (
    <div className="flex max-w-xl flex-col gap-8">
      {(workspaces ?? []).map((workspace) => (
        <BoardColumnsEditor
          key={workspace.id as string}
          workspaceId={workspace.id as string}
          workspaceName={workspace.name as string}
          columns={columnsByWorkspace.get(workspace.id as string) ?? []}
        />
      ))}
    </div>
  );
}
```

Create `src/app/settings/board-columns-editor.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createBoardColumn } from "@/app/board/actions";
import type { BoardColumn } from "@/app/board/group-columns";
import { toast } from "@/components/toaster";
import { ColumnRow } from "./column-row";

export function BoardColumnsEditor({
  workspaceId,
  workspaceName,
  columns,
}: {
  workspaceId: string;
  workspaceName: string;
  columns: BoardColumn[];
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function addColumn(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;

    setSaving(true);
    // New columns start grey; the colour picker is one click away and guessing a hue would be worse
    // than a neutral default.
    const result = await createBoardColumn({ workspaceId, name, color: "tab20-grey" });
    setSaving(false);

    if (!result.ok) {
      toast(result.error ?? "Could not add the column", "error");
      return;
    }

    setNewName("");
    router.refresh();
  }

  return (
    <section aria-label={`${workspaceName} columns`}>
      <h2 className="text-base font-semibold">{workspaceName}</h2>
      <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
        These columns are shared. Changes apply to everyone in {workspaceName}.
      </p>

      <ul className="flex flex-col gap-2">
        {columns.map((column) => (
          <ColumnRow
            key={column.id}
            column={column}
            siblingCount={columns.length}
            onDeleted={() => router.refresh()}
          />
        ))}
      </ul>

      <form onSubmit={addColumn} className="mt-3 flex items-center gap-2">
        <input
          aria-label={`New column name for ${workspaceName}`}
          value={newName}
          maxLength={40}
          placeholder="Add a column"
          onChange={(event) => setNewName(event.target.value)}
          className="min-h-11 flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm"
        />
        <button
          type="submit"
          disabled={saving || newName.trim().length === 0}
          className="min-h-11 rounded-sm bg-[var(--color-accent)] px-4 text-sm font-medium text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </section>
  );
}
```

Column reordering is deliberately not in this task: the editor renders columns in `position` order and
`reorderBoardColumn` already exists, but wiring a second `DragDropContext` here is separable work.
Note it in `tasks/todo.md` as the follow-up rather than half-building it.

- [ ] **Step 6: Run the settings tests**

Run: `npx jest src/app/settings`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/app/settings
git commit -m "feat(settings): add the board column editor

Rename saves on blur and colour on pick, both optimistic with rollback,
because neither moves a task. Delete is the only operation that needs a
decision from the user, so it is the only one behind a dialog.

The copy states that columns are shared, since a rename reaches everyone
in the workspace."
```

---

### Task 13: The delete dialog — a destination per task

**Files:**
- Create: `src/app/settings/delete-column-dialog.tsx` (replaces the placeholder)
- Test: `src/app/settings/delete-column-dialog.test.tsx`

**Interfaces:**
- Consumes: `listTasksInColumn`, `deleteBoardColumn`, `ColumnTask` (Task 5); `BoardColumn` (Task 8); `Dialog` from `src/components/dialog.tsx`.
- Produces: `<DeleteColumnDialog column={BoardColumn} siblings={BoardColumn[]} onClose={() => void} onDeleted={() => void} />`.

`ColumnRow` (Task 12) must pass `siblings` — the workspace's other columns — so update its call site
in the same commit.

- [ ] **Step 1: Write the failing tests**

Create `src/app/settings/delete-column-dialog.test.tsx`:

```tsx
jest.mock("@/app/board/actions", () => ({
  listTasksInColumn: jest.fn(),
  deleteBoardColumn: jest.fn(),
}));
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { deleteBoardColumn, listTasksInColumn } from "@/app/board/actions";
import { toast } from "@/components/toaster";
import { DeleteColumnDialog } from "./delete-column-dialog";
import type { BoardColumn } from "@/app/board/group-columns";

const WS = "a0000000-0000-4000-8000-000000000001";
const COL_A = "e0000000-0000-4000-8000-00000000000a";
const COL_B = "e0000000-0000-4000-8000-00000000000b";
const COL_DONE = "e0000000-0000-4000-8000-00000000000d";
const T1 = "c0000000-0000-4000-8000-000000000001";
const T2 = "c0000000-0000-4000-8000-000000000002";

function column(overrides: Partial<BoardColumn> & { id: string; name: string }): BoardColumn {
  return { workspaceId: WS, color: "tab20-blue", position: 1000, isDone: false, ...overrides };
}

const blocked = column({ id: COL_A, name: "Blocked", color: "tab20-red", position: 2000 });
const siblings = [
  column({ id: COL_B, name: "In Progress", position: 1000 }),
  column({ id: COL_DONE, name: "Completed", position: 3000, isDone: true, color: "tab20-green" }),
];

beforeEach(() => {
  jest.clearAllMocks();
  (deleteBoardColumn as jest.Mock).mockResolvedValue({ ok: true });
  (listTasksInColumn as jest.Mock).mockResolvedValue({
    ok: true,
    tasks: [
      { id: T1, title: "Call the plumber", completedAt: null },
      { id: T2, title: "Fix the garage light", completedAt: null },
    ],
  });
});

function open() {
  return render(
    <DeleteColumnDialog
      column={blocked}
      siblings={siblings}
      onClose={jest.fn()}
      onDeleted={jest.fn()}
    />
  );
}

it("lists every task in the column with its own destination select", async () => {
  open();

  expect(await screen.findByText("Call the plumber")).toBeInTheDocument();
  expect(screen.getByText("Fix the garage light")).toBeInTheDocument();
  expect(screen.getByLabelText("Move Call the plumber to")).toBeInTheDocument();
  expect(screen.getByLabelText("Move Fix the garage light to")).toBeInTheDocument();
});

it("defaults every destination to the deleted column's left neighbour", async () => {
  open();

  await waitFor(() => expect(screen.getByLabelText("Move Call the plumber to")).toHaveValue(COL_B));
  expect(screen.getByLabelText("Move Fix the garage light to")).toHaveValue(COL_B);
});

it("defaults to the right neighbour when deleting the leftmost column", async () => {
  render(
    <DeleteColumnDialog
      column={column({ id: COL_A, name: "Blocked", position: 500 })}
      siblings={siblings}
      onClose={jest.fn()}
      onDeleted={jest.fn()}
    />
  );

  await waitFor(() => expect(screen.getByLabelText("Move Call the plumber to")).toHaveValue(COL_B));
});

it("sends one move per task, using each row's own choice", async () => {
  open();
  await screen.findByText("Call the plumber");

  await userEvent.selectOptions(screen.getByLabelText("Move Fix the garage light to"), COL_DONE);
  await userEvent.click(screen.getByRole("button", { name: "Delete column" }));

  expect(deleteBoardColumn).toHaveBeenCalledWith({
    columnId: COL_A,
    moves: [
      { taskId: T1, targetColumnId: COL_B },
      { taskId: T2, targetColumnId: COL_DONE },
    ],
  });
});

it("sets every row at once from the move-all control", async () => {
  open();
  await screen.findByText("Call the plumber");

  await userEvent.selectOptions(screen.getByLabelText("Move all tasks to"), COL_DONE);

  expect(screen.getByLabelText("Move Call the plumber to")).toHaveValue(COL_DONE);
  expect(screen.getByLabelText("Move Fix the garage light to")).toHaveValue(COL_DONE);
});

it("skips the list for an empty column and still confirms", async () => {
  (listTasksInColumn as jest.Mock).mockResolvedValue({ ok: true, tasks: [] });
  open();

  expect(await screen.findByText("This column is empty.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Move all tasks to")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Delete column" }));

  expect(deleteBoardColumn).toHaveBeenCalledWith({ columnId: COL_A, moves: [] });
});

it("warns that completed tasks will vanish when deleting the terminal column", async () => {
  render(
    <DeleteColumnDialog
      column={column({ id: COL_DONE, name: "Completed", isDone: true })}
      siblings={[blocked, column({ id: COL_B, name: "In Progress" })]}
      onClose={jest.fn()}
      onDeleted={jest.fn()}
    />
  );

  expect(
    await screen.findByText(/completed tasks will no longer appear on the board/i)
  ).toBeInTheDocument();
});

it("reloads the list instead of deleting when the column changed underneath", async () => {
  (deleteBoardColumn as jest.Mock).mockResolvedValue({
    ok: false,
    error: "column changed since it was listed",
  });
  const onDeleted = jest.fn();
  render(
    <DeleteColumnDialog column={blocked} siblings={siblings} onClose={jest.fn()} onDeleted={onDeleted} />
  );
  await screen.findByText("Call the plumber");

  await userEvent.click(screen.getByRole("button", { name: "Delete column" }));

  expect(onDeleted).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith("This column changed — check the list and try again.", "error");
  expect(listTasksInColumn).toHaveBeenCalledTimes(2);
});

it("closes on cancel without deleting", async () => {
  const onClose = jest.fn();
  render(
    <DeleteColumnDialog column={blocked} siblings={siblings} onClose={onClose} onDeleted={jest.fn()} />
  );
  await screen.findByText("Call the plumber");

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onClose).toHaveBeenCalled();
  expect(deleteBoardColumn).not.toHaveBeenCalled();
});

it("has no accessibility violations", async () => {
  const { container } = open();
  await screen.findByText("Call the plumber");

  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/app/settings/delete-column-dialog.test.tsx`
Expected: FAIL — the placeholder renders `null`, so `findByText("Call the plumber")` times out.

- [ ] **Step 3: Write the dialog**

Create `src/app/settings/delete-column-dialog.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

import { deleteBoardColumn, listTasksInColumn, type ColumnTask } from "@/app/board/actions";
import type { BoardColumn } from "@/app/board/group-columns";
import { Dialog } from "@/components/dialog";
import { toast } from "@/components/toaster";

/**
 * Deleting a column asks where each of its tasks should go.
 *
 * Not built on ConfirmDialog: that component renders its body inside a <p>, and this body is a list
 * of selects. The buttons match its styling so the two read as the same kind of decision.
 *
 * "Move all to" only sets the individual selects — the payload is always per-task, so there is no
 * second code path where a bulk choice bypasses a row the user changed.
 */
export function DeleteColumnDialog({
  column,
  siblings,
  onClose,
  onDeleted,
}: {
  column: BoardColumn;
  siblings: BoardColumn[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [tasks, setTasks] = useState<ColumnTask[] | null>(null);
  const [targetByTaskId, setTargetByTaskId] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // The nearest column on the left, or the nearest on the right when deleting the leftmost. A
  // neighbour is the least surprising destination; there is no attempt to guess anything cleverer.
  const defaultTarget =
    [...siblings]
      .filter((s) => s.position < column.position)
      .sort((a, b) => b.position - a.position)[0]?.id ??
    [...siblings].sort((a, b) => a.position - b.position)[0]?.id ??
    "";

  const load = useCallback(async () => {
    const result = await listTasksInColumn({ columnId: column.id });
    if (!result.ok) {
      toast(result.error ?? "Could not load this column's tasks", "error");
      onClose();
      return;
    }

    setTasks(result.tasks);
    setTargetByTaskId(
      Object.fromEntries(result.tasks.map((task) => [task.id, defaultTarget]))
    );
  }, [column.id, defaultTarget, onClose]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm() {
    if (!tasks) return;

    setBusy(true);
    const result = await deleteBoardColumn({
      columnId: column.id,
      moves: tasks.map((task) => ({ taskId: task.id, targetColumnId: targetByTaskId[task.id] })),
    });
    setBusy(false);

    if (result.ok) {
      onDeleted();
      return;
    }

    // The RPC's coverage check failed: someone changed the column while this dialog was open. Show
    // what is actually there now rather than deleting a column whose contents were never seen.
    if (result.error?.includes("changed since it was listed")) {
      toast("This column changed — check the list and try again.", "error");
      void load();
      return;
    }

    toast(result.error ?? "Could not delete the column", "error");
  }

  const headingId = `delete-column-${column.id}`;

  return (
    <Dialog
      open
      onClose={onClose}
      initialFocusSelector="[data-cancel-button]"
      ariaLabelledBy={headingId}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-6 w-full max-w-md max-h-[90dvh] overflow-y-auto backdrop:bg-[var(--color-scrim)]"
    >
      <h3 id={headingId} className="mb-2 text-base font-semibold">
        Delete “{column.name}”?
      </h3>

      {tasks === null ? (
        <p className="text-sm text-[var(--color-text-secondary)]" aria-busy="true">
          Loading this column’s tasks…
        </p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">This column is empty.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
            {tasks.length} {tasks.length === 1 ? "task is" : "tasks are"} in this column. Choose where
            each one goes.
          </p>

          <label className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-[var(--color-text-secondary)]">Move all tasks to</span>
            <select
              aria-label="Move all tasks to"
              defaultValue=""
              onChange={(event) => {
                const target = event.target.value;
                if (!target) return;
                setTargetByTaskId(Object.fromEntries(tasks.map((task) => [task.id, target])));
              }}
              className="min-h-11 flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
            >
              <option value="">Choose a column…</option>
              {siblings.map((sibling) => (
                <option key={sibling.id} value={sibling.id}>
                  {sibling.name}
                </option>
              ))}
            </select>
          </label>

          <ul className="mb-4 flex max-h-64 flex-col gap-2 overflow-y-auto">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm" title={task.title}>
                  {task.title}
                </span>
                <select
                  aria-label={`Move ${task.title} to`}
                  value={targetByTaskId[task.id] ?? ""}
                  onChange={(event) =>
                    setTargetByTaskId((prev) => ({ ...prev, [task.id]: event.target.value }))
                  }
                  className="min-h-11 w-40 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
                >
                  {siblings.map((sibling) => (
                    <option key={sibling.id} value={sibling.id}>
                      {sibling.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}

      {column.isDone && (
        <p className="mb-4 rounded-sm bg-[var(--color-warning-surface)] p-2 text-sm text-[var(--color-warning-text)]">
          This is where completed tasks appear. Without it, completed tasks will no longer appear on
          the board.
        </p>
      )}

      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
        This applies to everyone in the workspace.
      </p>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          data-cancel-button
          onClick={onClose}
          className="min-h-11 rounded-sm border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-accent-subtle)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy || tasks === null}
          className="min-h-11 rounded-sm bg-[var(--color-danger-solid)] px-4 py-2 text-sm font-medium text-[var(--color-text-on-solid)] hover:bg-[var(--color-danger-solid-hover)] disabled:opacity-50 transition-colors"
        >
          Delete column
        </button>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 4: Pass `siblings` from the column row**

In `src/app/settings/column-row.tsx`, add a `siblings: BoardColumn[]` prop and forward it to
`DeleteColumnDialog`; in `src/app/settings/board-columns-editor.tsx`, pass
`siblings={columns.filter((c) => c.id !== column.id)}`. Update `column-row.test.tsx`'s renders to
include `siblings={[]}`.

- [ ] **Step 5: Run the settings suite**

Run: `npx jest src/app/settings`
Expected: PASS, including the 10 dialog tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/app/settings
git commit -m "feat(settings): choose a destination per task when deleting a column

The dialog lists the column's tasks with a select each; \"move all to\"
only sets those selects, so the payload is always per-task and no bulk
choice can bypass a row the user changed.

A failed coverage check reloads the list instead of deleting: the column
changed while the dialog was open, so the user has not seen what they
would be deleting."
```

---

### Task 14: End-to-end coverage

**Files:**
- Create: `e2e/board.spec.ts`

**Interfaces:**
- Consumes: the running app; `e2e/fixtures.ts` for the authenticated context, following the existing specs.

- [ ] **Step 1: Read the existing fixtures and one spec**

Read `e2e/fixtures.ts` and `e2e/drag-reorder.spec.ts` before writing anything: they establish how a
signed-in page is obtained and how this suite drives `@hello-pangea/dnd` (keyboard drags, because the
library's pointer sensors are unreliable under automation). Follow both exactly.

- [ ] **Step 2: Write the spec**

Create `e2e/board.spec.ts`:

```ts
import { expect, test } from "./fixtures";

test.describe("kanban board", () => {
  test("the seeded columns are on the board", async ({ page }) => {
    await page.goto("/board");

    for (const name of ["Not Started", "In Progress", "Blocked", "Follow-up", "Completed"]) {
      await expect(page.getByRole("region", { name: new RegExp(`^${name},`) })).toBeVisible();
    }
  });

  test("a card carries its title, deadline and workspace and nothing else", async ({ page }) => {
    await page.goto("/board");
    const card = page.getByRole("article").first();

    await expect(card).toBeVisible();
    // The board deliberately omits descriptions and subtask counts.
    await expect(card).not.toContainText("subtask");
  });

  test("a column can be added, recoloured and renamed, and a rename leaves cards where they are", async ({
    page,
  }) => {
    await page.goto("/settings?tab=board");

    await page.getByLabel(/^New column name/).first().fill("Waiting on parts");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("button", { name: "Delete Waiting on parts" })).toBeVisible();

    await page.getByRole("button", { name: "Colour for Waiting on parts" }).click();
    await page.getByRole("radio", { name: "tab20-cyan" }).click();

    await page.goto("/board");
    const columnTasks = page.getByRole("region", { name: /^Blocked,/ });
    const before = await columnTasks.getByRole("article").allInnerTexts();

    await page.goto("/settings?tab=board");
    const nameInput = page
      .getByRole("region", { name: /columns$/ })
      .first()
      .getByLabel("Column name")
      .nth(2);
    await nameInput.fill("Parked");
    await nameInput.blur();

    await page.goto("/board");
    const after = await page.getByRole("region", { name: /^Parked,/ }).getByRole("article").allInnerTexts();
    expect(after).toEqual(before);
  });

  test("dragging a card into Completed completes it in the list view", async ({ page }) => {
    await page.goto("/board");

    const card = page.getByRole("region", { name: /^Not Started,/ }).getByRole("article").first();
    const title = (await card.getByRole("heading").innerText()).trim();

    // Keyboard drag: space to lift, arrow to move across columns, space to drop. Same approach as
    // e2e/drag-reorder.spec.ts.
    await card.focus();
    await page.keyboard.press("Space");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");

    await expect(
      page.getByRole("region", { name: /^Completed,/ }).getByText(title)
    ).toBeVisible();

    await page.goto("/tasks");
    await expect(page.getByRole("button", { name: /completed/i }).first()).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
  });

  test("the done column expands to older history", async ({ page }) => {
    await page.goto("/board");
    const done = page.getByRole("region", { name: /^Completed,/ });

    await done.getByRole("button", { name: /Show older/ }).click();
    await expect(done.getByRole("button", { name: /Show more|No older tasks/ })).toBeVisible();
  });

  test("deleting a column sends each task where it was told to go", async ({ page }) => {
    await page.goto("/settings?tab=board");

    await page.getByRole("button", { name: "Delete Blocked" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const rows = dialog.getByRole("listitem");
    const count = await rows.count();
    test.skip(count < 2, "needs at least two tasks in Blocked to exercise per-task destinations");

    const firstTitle = (await rows.nth(0).innerText()).split("\n")[0].trim();
    const secondTitle = (await rows.nth(1).innerText()).split("\n")[0].trim();

    await dialog.getByLabel(`Move ${firstTitle} to`).selectOption({ label: "In Progress" });
    await dialog.getByLabel(`Move ${secondTitle} to`).selectOption({ label: "Follow-up" });
    await dialog.getByRole("button", { name: "Delete column" }).click();

    await page.goto("/board");
    await expect(page.getByRole("region", { name: /^Blocked,/ })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: /^In Progress,/ }).getByText(firstTitle)
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: /^Follow-up,/ }).getByText(secondTitle)
    ).toBeVisible();
  });
});
```

- [ ] **Step 3: Seed enough data for the delete test, then run**

The delete test needs at least two tasks in Blocked. Create them through the UI on `/tasks` and drag
them across on `/board` first, or extend the e2e seed the same way `e2e/global-setup.ts` seeds the
existing fixtures — follow whichever that file already does rather than inventing a second mechanism.

Run: `npm run test:e2e -- board.spec.ts`
Expected: PASS. A skipped delete test means the seed did not produce two tasks in Blocked — fix the
seed rather than lowering the assertion.

- [ ] **Step 4: Run the whole e2e suite, including screenshots**

Run: `npm run test:e2e`
Expected: PASS. If `screenshots.spec.ts` fails only because the nav now has a Board link, update the
baselines deliberately (`npm run test:e2e -- --update-snapshots screenshots.spec.ts`) and review the
diff before committing it. Do not update baselines to paper over an unexpected layout change.

- [ ] **Step 5: Commit**

```bash
git add e2e/board.spec.ts e2e/screenshots.spec.ts-snapshots
git commit -m "test(e2e): cover the board, column editing and column deletion

Keyboard drags, matching drag-reorder.spec.ts: the library's pointer
sensors are unreliable under automation.

The delete test sends two tasks to two different destinations, which is
the behaviour a single bulk destination would have hidden."
```

---

### Task 15: Documentation

**Files:**
- Modify: `docs/db.md` (add `board_columns`, the new `tasks` column, and the indexing note)
- Modify: `docs/product.md` (add a Board View section)
- Modify: `tasks/todo.md` (record the deferred column reordering)
- Modify: `tasks/lessons.md` (only if something in this build contradicted an assumption)

**Interfaces:**
- Consumes: everything above.
- Produces: docs that match the shipped behaviour.

- [ ] **Step 1: Document the table in `docs/db.md`**

Add a `### board_columns` section after `task_rules`, in the same prose style as its neighbours:
columns and types, then a Notes block covering — columns are workspace-scoped and shared by that
workspace's members; at most one `is_done` column per workspace; names are unique per workspace
case-insensitively because the all-workspaces board merges by `lower(name)`; the tab20 slug list is
duplicated in `src/app/board/colors.ts` and both must change together.

Extend the `### tasks` section with `board_column_id`, and note: the FK is `restrict`, so a column can
only be removed through `delete_board_column`, which reassigns every task first;
`check ((parent_task_id is null) = (board_column_id is not null))` means a root task always has a
column and a subtask never does.

Add to `## Indexing`: `board_columns.(workspace_id, position)` and `tasks.board_column_id`.

- [ ] **Step 2: Document the view in `docs/product.md`**

Add a `## Board View` section after `## Visibility and Views`:

- The board shows root tasks only, as cards carrying title, deadline and workspace. Subtasks,
  descriptions and updates are the list view's job.
- Columns are defined per workspace and shared by its members. Any member may add, rename, recolour
  or delete a column, and a change applies to everyone in that workspace.
- Moving a task between columns moves it for every assignee. Vertical order within a column remains
  per user, the same ordering the list view uses.
- One column per workspace may be marked as the completed column. Dragging a task there completes it,
  with the existing subtask rules; dragging it out reopens it. A completed task always appears in
  that column, whichever column it was in before.
- The completed column shows the last 7 days by default and expands on request.
- Deleting a column asks where each of its tasks should go. Renaming a column never moves a task.
- Default columns for a new workspace: Not Started, In Progress, Blocked, Follow-up, Completed.

- [ ] **Step 3: Record the deferred work in `tasks/todo.md`**

Add, in whatever format that file already uses: column reordering is not wired up — `position` is
respected everywhere and `reorderBoardColumn` exists and is tested, but no drag handle calls it yet.
New columns land at the end of the list.

- [ ] **Step 4: Full verification before the final commit**

```bash
npm run typecheck
npm test
npm run lint
npm run test:e2e
```

Expected: all four clean. Report any failure as a failure with its output; do not describe the
feature as done while one is red.

- [ ] **Step 5: Commit**

```bash
git add docs/db.md docs/product.md tasks/todo.md tasks/lessons.md
git commit -m "docs: document the board view and board_columns

Records the rules that are not visible in the schema: completion is
derived rather than stored twice, deletion asks per task, renaming never
moves anything, and the tab20 slug list is duplicated between the check
constraint and colors.ts."
```

---

## Verification Summary

The feature is done when all of these hold, each checked by running the command, not by inspection:

- `npm run typecheck` — clean
- `npm test` — clean, including: `colors.test.ts` (45), `schemas.test.ts` (11), `group-columns.test.ts` (15), `actions.test.ts` (14), `move-actions.test.ts` (11), `board-card.test.tsx` (9), `board-client.test.tsx` (8), the settings suite, and the pre-existing `src/app/tasks` suites unchanged in count
- `npm run lint` — clean
- `npm run test:e2e` — clean, including `board.spec.ts`
- Migrations `015` and `016` applied to **dev**; production untouched and explicitly out of scope for this plan
- A card dragged between columns is still there after a reload, and after a reload in the other member's session
- Dragging a card into the completed column shows it completed on `/tasks`; dragging it out reopens it
- Deleting a column with two tasks sent to two different destinations puts each where it was sent
- Renaming a column leaves every card in place
