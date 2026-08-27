# Kanban Board View — Design

Date: 2026-08-26
Status: approved, not yet implemented

## Goal

A per-user kanban board of tasks at `/board`, with drag-and-drop between user-defined columns, and a
per-user settings surface for defining those columns and their colors.

Cards are deliberately thin: title, deadline, workspace. No subtasks, no descriptions, no updates.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| What a column means | Per-user status stored on `task_assignments` | Matches the app's existing per-user model (`member_sort_key`). Shared tasks can sit in different columns for different people. |
| Completion | One column may be marked terminal (`is_done`) | Dragging into it runs the existing `completeTask`, so subtask-cascade rules keep applying. One source of truth for "done". |
| Color placement | tab20 color on the column, deadline color on the card | Both signals stay readable. Deadline urgency stays the loudest thing on a card. |
| Route | New `/board`, peer to `/tasks` | `tasks-page-client.tsx` is already 417 lines; a second full layout does not belong in it. |
| Card order within a column | Reuse `member_sort_key` | One priority list, two views. Reuses `reorderTask` and `computeNeighborKeys` unchanged. No second ordering to drift. |
| Settings home | New `/settings` with Profile + Board tabs | Gives per-user settings a real home. `/profile` content moves in as the first tab. |
| Done column contents | Last 7 days by default, expandable | Bounded default query; full history reachable on demand. |

Default columns seeded per user, in order:
`Not Started`, `In Progress`, `Blocked`, `Follow-up`, `Completed` (terminal).

## Data model

Migration `015_board_columns.sql`.

### board_columns

```
id            uuid primary key
auth_user_id  uuid not null            -- owner
name          text not null
color         text not null            -- tab20 slug; check constraint against the 20 allowed values
position      numeric not null         -- sparse keys, same approach as member_sort_key
is_done       boolean not null default false
created_at    timestamptz not null default now()

unique (auth_user_id, name)
unique index (auth_user_id) where is_done      -- at most one terminal column per user
index (auth_user_id, position)
```

Owned by the auth user, not by a workspace member: members are workspace-scoped, but a user has one
set of columns across every workspace.

### task_assignments (altered)

```
board_column_id uuid null references board_columns(id) on delete set null
```

Per-user status, since assignments are per-member.

Two properties this relies on:

- **`null` is legal and means "the user's first column."** No backfill of existing assignment rows is
  needed, and `on delete set null` means deleting a column drops its cards back to the first column
  rather than losing them. Fail-safe by construction.
- **Trigger `board_column_owner_matches_member`** rejects any write setting `board_column_id` to a
  column whose `auth_user_id` differs from the assignment member's `auth_user_id`. Without it, the
  existing `task_assignments` update policy — which permits updating rows for tasks the caller is
  assigned to — would let a user park their own task in another user's column id.

### RLS

`board_columns`: select/insert/update/delete all gated on `auth_user_id = auth.uid()`. No user can
see or touch another user's columns.

`task_assignments` policies are unchanged; the new column is protected by the trigger above.

### Seeding

`ensure_default_board_columns(p_auth_user_id uuid)`, security definer, inserts the five defaults only
if the user has zero columns. Idempotent. Called lazily on first `/board` or `/settings` load, so
existing users get columns without a signup-hook change or a data migration.

## Completion is derived, not duplicated

A task with `completed_at` set renders in the done column regardless of its `board_column_id`.
`board_column_id` is consulted only for non-completed tasks.

Consequences:

- Completing a task from the list view moves its card on the board with no extra write.
- The two views cannot disagree about what is done.
- A user with no terminal column simply does not see completed tasks on the board.

## Server actions

`src/app/board/actions.ts`, using `ActionResult` and the `action-run.ts` wrapper, matching
`src/app/tasks/actions.ts`.

- `moveTaskToColumn({ taskId, columnId, prevKey, nextKey })` — the whole drop in one action. Writes
  `board_column_id` and `member_sort_key` in a single `task_assignments` update so a drop never
  half-applies. If the target column is terminal, also calls `completeTask` (preserving the subtask
  cascade). If the task was completed and the target is not terminal, calls `reopenTask`. A
  same-column drop is a pure reorder.
- `loadOlderDone({ before })` — keyset pagination on `completed_at` (not offset; offset drifts when a
  task is reopened mid-scroll). Returns up to 50 older completed tasks.
- `createBoardColumn`, `renameBoardColumn`, `setBoardColumnColor`, `reorderBoardColumn`,
  `deleteBoardColumn`.

Guards: the last remaining column cannot be deleted. Deleting the terminal column is permitted but
warns that completed cards will no longer appear on the board.

Zod schemas in `src/app/board/schemas.ts`. Color validated against a 20-member slug union, mirroring
the DB check constraint.

## Board UI — `/board`

Server component fetches, client component renders — same split as `src/app/tasks/page.tsx`.

Query: root tasks only (`parent_task_id is null`), selecting `id, title, due_at, workspace_id,
completed_at`. Assignee counts reused from the same approach as `/tasks` for the shared indicator.

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

Board tab: a draggable list of columns. Each row has a drag handle, a name input, a color swatch
popover (twenty tab20 chips in a 5×4 grid), a terminal-column radio (exactly one selected), and
delete. An add-column row sits at the bottom. Fields save on blur, optimistically, with a toast on
failure.

## Testing

Unit:
- Color-slug validation against the tab20 union
- Done-column derivation: `completed_at` beats `board_column_id`
- Column grouping and the 7-day done filter
- Neighbor-key math for cross-column drops

Action tests against `src/test/supabase-fake.ts`, mirroring `src/app/tasks/actions.test.ts`:
- Drop into the terminal column completes the task
- Drag out of the terminal column reopens it
- Deleting a column nulls its assignments' `board_column_id`
- A column id belonging to another user is rejected
- `loadOlderDone` keyset pagination returns the right window

Migration: dry-run against the dev Supabase project inside `BEGIN … ROLLBACK` (no local Postgres in
this environment).

E2E: create a column, recolor it, drag a card across columns, drag into done and confirm the list
view shows it completed, expand the done column. The due-date input is already masked in screenshot
baselines.

## Out of scope

Subtasks on the board. Per-task color overrides. WIP limits. Swimlanes. Sharing column sets between
users. Notion sync — assessed separately on 2026-08-26 and declined: per-user priority and
assignment-based visibility have no clean mapping onto Notion's single shared order and
workspace-wide page visibility, and two-way sync is a subsystem rather than a feature. Columns are
modeled as named statuses with stable ids, which keeps a future status mapping cheap.
