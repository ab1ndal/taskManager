# Kanban Board View — Design

Date: 2026-08-26 (revised 2026-08-27: columns and status are shared per workspace, not per user)
Status: approved, not yet implemented

## Goal

A kanban board of tasks at `/board`, with drag-and-drop between columns that the workspace's members
define together, plus a settings surface for editing those columns and their colors.

Cards are deliberately thin: title, deadline, workspace. No subtasks, no descriptions, no updates.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Column scope | One set per workspace, shared by its members | Column names stay consistent across profiles. Household and Work can differ. |
| What a column means | Shared status on `tasks.board_column_id` | Moving a shared task moves it for everyone. Keeps the model small: one status per task. |
| Card order within a column | Per-user, reusing `member_sort_key` | Priority stays personal even though status is shared. Reuses `reorderTask` and `computeNeighborKeys` unchanged. |
| Completion | One column per workspace may be terminal (`is_done`) | Dragging into it runs the existing `completeTask`, so the subtask cascade keeps applying. `completed_at` is already shared, so status and completion agree by construction. |
| Edit rights | Any workspace member | Two-person tool; no role concept to administer. |
| Color placement | tab20 color on the column, deadline color on the card | Both signals stay readable. Deadline urgency stays the loudest thing on a card. |
| Route | New `/board`, peer to `/tasks` | `tasks-page-client.tsx` is already 417 lines; a second full layout does not belong in it. |
| Settings home | New `/settings` with Profile + Board tabs | Gives settings a real home. `/profile` content moves in as the first tab. |
| Done column contents | Last 7 days by default, expandable | Bounded default query; full history reachable on demand. |
| All-workspaces board | Merge columns by name | Defaults are seeded identically per workspace, so the combined board normally shows one set. |

Default columns seeded per workspace, in order:
`Not Started`, `In Progress`, `Blocked`, `Follow-up`, `Completed` (terminal).

### Accepted tradeoff

A shared task in "Blocked" reads as blocked for every assignee, even when only one person is
blocked. This was chosen deliberately over per-user status, in exchange for consistent column names
and a much smaller data model. Per-user vertical ordering inside a column preserves personal
priority.

## Data model

Migration `015_board_columns.sql`.

### board_columns

```
id            uuid primary key
workspace_id  uuid not null references workspaces(id) on delete cascade
name          text not null
color         text not null            -- tab20 slug; check constraint against the 20 allowed values
position      numeric not null         -- sparse keys, same approach as member_sort_key
is_done       boolean not null default false
created_at    timestamptz not null default now()

unique index (workspace_id, lower(name))       -- case-insensitive, so "Blocked"/"blocked" can't both exist
unique index (workspace_id) where is_done      -- at most one terminal column per workspace
index (workspace_id, position)
```

Case-insensitive name uniqueness matters here because the all-workspaces board merges columns by
normalized name.

### tasks (altered)

```
board_column_id uuid null references board_columns(id) on delete set null
```

Shared status: one column per task, so a move is a move for everyone.

Two properties this relies on:

- **`null` is legal and means "the workspace's first column by position."** No backfill of existing
  task rows is needed, and `on delete set null` means deleting a column drops its cards back to the
  first column rather than losing them. Fail-safe by construction.
- **Trigger `board_column_workspace_matches_task`** rejects a write where the column's `workspace_id`
  differs from the task's own workspace, and rejects any non-null `board_column_id` on a subtask
  (subtasks carry no workspace — migration 011). A cross-table condition can't be a check constraint,
  so this is a trigger.

### RLS

`board_columns`: all four policies use the existing helper —
`using ( private.is_workspace_member(workspace_id) )`, with the same expression as the insert/update
`with check`. Consistent with migration 007, and non-recursive.

`tasks` policies are unchanged; the new column is constrained by the trigger above.

### Seeding

`AFTER INSERT` trigger on `workspaces` inserts the five defaults. A trigger rather than a call inside
`createWorkspace` so every code path (including `joinWorkspaceByDirectory` and any future import)
gets columns. The migration also backfills every existing workspace.

## Atomicity

A drop writes two tables: `tasks.board_column_id` (shared) and `task_assignments.member_sort_key`
(the caller's row only). That needs one transaction, so it goes in an RPC:

`public.move_task_to_column(p_task_id uuid, p_column_id uuid, p_prev_key numeric, p_next_key numeric)`

Security definer, following migration 010's `move_task_workspace` exactly: execute revoked from
`public`, `anon`, and `authenticated`, granted only to `service_role`, and the function re-checks
membership itself rather than trusting the caller. Called through `src/lib/supabase/admin.ts`.

The function asserts: caller is a member of the task's workspace, the target column belongs to that
workspace, and the task is a root task.

## Server actions

`src/app/board/actions.ts`, using `ActionResult` and the `action-run.ts` wrapper, matching
`src/app/tasks/actions.ts`.

- `moveTaskToColumn({ taskId, columnId, prevKey, nextKey })` — calls the RPC above. If the target
  column is terminal, also calls `completeTask` (preserving the subtask cascade). If the task was
  completed and the target is not terminal, calls `reopenTask`. A same-column drop is a pure reorder
  and reuses `reorderTask`.
- `loadOlderDone({ before })` — keyset pagination on `completed_at` (not offset; offset drifts when a
  task is reopened mid-scroll). Returns up to 50 older completed tasks.
- `createBoardColumn`, `renameBoardColumn`, `setBoardColumnColor`, `reorderBoardColumn`,
  `deleteBoardColumn` — each scoped to a workspace the caller belongs to.

Guards: a workspace's last remaining column cannot be deleted. Deleting the terminal column is
permitted but warns that completed cards will no longer appear on the board. Renaming to an existing
name (case-insensitively) fails on the unique index and surfaces as a field error.

Zod schemas in `src/app/board/schemas.ts`. Color validated against a 20-member slug union, mirroring
the DB check constraint.

## Board UI — `/board`

Server component fetches, client component renders — same split as `src/app/tasks/page.tsx`.

Query: root tasks only (`parent_task_id is null`), selecting `id, title, due_at, workspace_id,
completed_at, board_column_id`, plus `board_columns` for the workspaces in scope. Assignee counts
come from the same approach `/tasks` already uses, for the shared indicator.

Layout: horizontally scrolling column track. Each column `min-w-[280px]` with a sticky header.
`DragDropContext` with one `Droppable` per column and `Draggable` cards, using `@hello-pangea/dnd`
(already a dependency, already used for list reorder).

Card contents, and nothing more:

- Title, single line, truncated
- Due-date pill: red overdue, yellow within 24h, green otherwise; no due date renders green. Same
  rules as `src/app/tasks/bucket-tasks.ts`
- Workspace chip using the existing `--color-kind-household-*` / `--color-kind-work-*` tokens
- Shared indicator (small avatar stack) only when a task has more than one assignee

Column color: a 3px top rail plus a tinted header. Twenty tab20 custom properties are added to
`globals.css` in both the light and dark blocks; rail, chip, and tint are derived with
`color-mix(in oklab, var(--col) 14%, var(--color-surface))`, so one token per color covers every
usage in both themes. Card bodies stay `--color-surface`.

Workspace scope: reuse the `?workspace=` search param from `/tasks` so switching views preserves
scope. Nav gains a "Board" link.

### All-workspaces scope

Columns are grouped by `lower(name)`. A merged column's position is the minimum position among its
members; its color is the shared one when every contributing column agrees, and neutral
`--color-surface` when they disagree, with the column name still shown normally.

Dropping a card into a merged column resolves to the column with that name *in the card's own
workspace*. If that workspace has no column by that name, the drop is rejected and a toast explains
why ("Work has no Follow-up column"). Nothing is created implicitly.

### Done column

- Default: tasks with `completed_at` in the last 7 days, newest first.
- Footer button "Show older (N)"; N comes from a `head: true` count query rather than fetching rows.
- Each press appends the next 50 via `loadOlderDone`, becoming "Show more (N)" and finally
  "No older tasks".
- Older rows join the same `Droppable`, so dragging one out still calls `reopenTask`.
- Expansion is client state, reset on navigation — deliberately not in the URL, so no shareable link
  triggers an unbounded fetch on load.
- Once expanded the column gets a `max-h` with internal scroll, so history does not stretch the board.

### Accessibility

`@hello-pangea/dnd` provides keyboard dragging. Columns carry `aria-label="<name>, N tasks"`, and
drops announce through a live region. The board gets a `jest-axe` assertion like the existing pages.

The visual pass runs through the `ui-ux-pro-max` skill before the board UI is written.

## Settings — `/settings`

New route with tab pills, reusing `src/app/tasks/tab-pill.tsx`: **Profile** | **Board**.

The existing `/profile` content moves to the Profile tab verbatim. `/profile` redirects to
`/settings?tab=profile` so existing links and bookmarks keep working.

Board tab: a workspace selector, then a draggable list of that workspace's columns. Each row has a
drag handle, a name input, a color swatch popover (twenty tab20 chips in a 5×4 grid), a
terminal-column radio (exactly one selected), and delete. An add-column row sits at the bottom.
Fields save on blur, optimistically, with a toast on failure.

Because columns are shared, the tab states plainly that changes apply to everyone in the workspace,
and delete asks for confirmation via the existing `delete-confirm-dialog.tsx`.

## Testing

Unit:
- Color-slug validation against the tab20 union
- Column grouping, including `null` board_column_id falling into the first column
- Merge-by-name grouping: shared color vs neutral on disagreement, minimum position wins
- The 7-day done filter
- Neighbor-key math for cross-column drops

Action tests against `src/test/supabase-fake.ts`, mirroring `src/app/tasks/actions.test.ts`:
- Drop into the terminal column completes the task; drag out reopens it
- Deleting a column nulls its tasks' `board_column_id`
- A column id from another workspace is rejected
- A subtask cannot be given a column
- Dropping into a merged column name the card's workspace lacks is rejected
- `loadOlderDone` keyset pagination returns the right window

Migration: dry-run against the dev Supabase project inside `BEGIN … ROLLBACK` (no local Postgres in
this environment).

E2E: create a column, recolor it, drag a card across columns, drag into done and confirm the list
view shows it completed, expand the done column. The due-date input is already masked in screenshot
baselines.

## Out of scope

Subtasks on the board. Per-task color overrides. WIP limits. Swimlanes. Per-user status.

**Live updates.** Because status is shared, one member's move leaves another member's open board
stale until they refresh. Not solved here — no Realtime subscription, no polling. If it becomes
annoying, the cheap next step is `router.refresh()` on window focus.

**Notion sync** — assessed 2026-08-26 and declined: two-way sync is a subsystem rather than a
feature, and assignment-based visibility has no clean mapping onto Notion's workspace-wide page
visibility. Shared per-workspace columns do map cleanly onto a Notion select field, so if this is
ever revisited, a one-way export is the cheap version.
