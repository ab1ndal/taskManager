# Phase 5: Task Prioritization — Design

## Context

Roadmap Phase 5. Depends on Phase 4 (accessibility & mobile — 5/6 plans complete, one manual
verification checkpoint open). Requirement TASK-06.

`reorderTask()` (`src/app/tasks/actions.ts:325`) already exists: authenticated, authorized (only
your own `member_sort_key` rows), validated (`reorderTaskSchema` — `prevKey`/`nextKey`, both
nullable, `prevKey < nextKey` refine), tested. It has no UI caller.

Audit finding C3: `nextSortKey()` (`actions.ts:81-94`) is a read-then-write race. Two concurrent
task creations (or assignee adds) for the same member can read the same `MAX(member_sort_key)` and
both insert `+1000`, producing a duplicate/colliding key. This must be fixed before UI reordering
ships on top of it — reordering assumes distinct keys per member.

`@hello-pangea/dnd@18.0.1` is already an installed, unused dependency — clearly staged for this
phase. It ships built-in keyboard support (Space to lift, arrow keys to move, Space to drop, Escape
to cancel), which satisfies the keyboard-alternative requirement without separate implementation.

## Scope

**In scope:**
- Fix the `nextSortKey()` race (C3) via an atomic Postgres function.
- Drag-to-reorder within a bucket, for Overdue / Today / Upcoming buckets.
- Keyboard reordering via `@hello-pangea/dnd`'s built-in keyboard mode.
- Optimistic UI update with rollback on server failure.

**Out of scope:**
- Completed bucket is not reorderable (no purpose — tasks are done).
- Cross-bucket drag (e.g. Today → Upcoming). Bucket membership is derived from `due_at`, not user
  choice; dragging across buckets would need to also change the due date, which is a distinct
  feature. Disabled at the `onDragEnd` level (no-op when `source.droppableId !==
  destination.droppableId`), not just visually discouraged.
- Subtask reordering. Buckets only ever contain top-level tasks (`page.tsx` queries
  `parent_task_id is null`); subtasks aren't part of this ordering system.
- Periodic sort-key rebalancing (float precision drift over many reorders). Known limitation,
  not addressed here — `member_sort_key` is a `numeric`/float column with enough range that this
  won't matter at realistic task-list sizes.
- Subtask editing/adding on existing tasks — a separate feature raised during this brainstorm,
  deferred to its own design after this one ships.

## C3 Fix: Atomic `nextSortKey`

Replace the client-side read-then-write with a Postgres function using a per-member advisory
transaction lock:

```sql
create or replace function next_sort_key(p_member_id uuid)
returns numeric
language plpgsql
security definer
as $$
declare
  v_key numeric;
begin
  perform pg_advisory_xact_lock(hashtext(p_member_id::text));
  select coalesce(max(member_sort_key), 0) + 1000
  into v_key
  from task_assignments
  where member_id = p_member_id;
  return v_key;
end;
$$;
```

The lock is scoped per-member (`hashtext(member_id)`), so concurrent inserts for *different*
members never contend — only two concurrent creations for the *same* member serialize, which is
the actual race window. Lock releases automatically at transaction end (`pg_advisory_xact_lock`),
no manual unlock needed.

Callers to update (all three currently call `nextSortKey()` inline):
- `createTaskWithSubtasks` — assignee insert loop (`actions.ts` ~L207)
- `updateTask` — new-assignee-add loop (`actions.ts` ~L247)
- `nextSortKey()` itself becomes a thin RPC wrapper: `admin.rpc('next_sort_key', { p_member_id: memberId })`

Ships as a new migration (next sequential number after `007_rls_security_definer.sql`).

## Drag-to-Reorder UI

**Structure:** One `DragDropContext` wrapping the bucketed task list in `TasksPageClient`. One
`Droppable` per active bucket (Overdue, Today, Upcoming). Each `TaskCard` wrapped in a `Draggable`.

**State:** Extend `TasksPageClient`'s existing state-ownership pattern (it already owns
`optimisticTaskIds` from the Phase 2/3 optimistic-insert work) with per-bucket local arrays that
can be locally reordered ahead of server confirmation.

**`onDragEnd(result)` flow:**
1. No-op if `result.destination` is null, or `source.droppableId !== destination.droppableId`
   (cross-bucket blocked), or `source.index === destination.index` (dropped in place).
2. Splice the dragged task into its new local position — this is the optimistic move, instant
   visual reorder.
3. Compute `{ prevKey, nextKey }` from the two tasks now adjacent to it via a new pure helper,
   `computeNeighborKeys(bucketArray, toIndex)` — `null` for either when dropped at an array
   boundary.
4. Call `reorderTask({ taskId, memberId: currentUserMemberId, prevKey, nextKey })`, where
   `currentUserMemberId` comes from the existing signed-in-user member context already available
   to `TasksPageClient` (not refetched).
5. On failure: revert the local splice back to the pre-drag order, show an error toast via the
   existing (Phase 4) assertive live-region toaster.

No schema changes — `reorderTaskSchema` already matches this call shape exactly.

## Testing

- `computeNeighborKeys` — new pure-function unit tests (`reorder-helpers.test.ts`): boundary cases
  (drop at start/end of a bucket), middle-of-list, single-item bucket.
- `tasks-page-client.test.tsx` — extend with `@hello-pangea/dnd` test-utility drag simulations:
  same-bucket reorder calls `reorderTask` with correct keys; cross-bucket drop is a no-op; server
  failure reverts order and shows an error toast.
- Migration/concurrency test for `next_sort_key`: fire N concurrent calls for the same member,
  assert N distinct returned keys. This is the actual regression test for C3 — no existing test
  can exercise the race.
- **Manual-only** (same pattern as Phase 4's `04-06`): keyboard reorder via Tab/Space/Arrow/Escape
  isn't meaningfully unit-testable against `@hello-pangea/dnd`'s real keyboard handling — needs a
  human pass in a real browser. Will be recorded in a `05-VERIFICATION.md` checklist, structured
  like `04-VERIFICATION.md`.

## Open Questions Resolved During Brainstorm

- Buckets: Overdue/Today/Upcoming only, not Completed.
- No cross-bucket drag.
- C3 fix: atomic Postgres function (advisory lock), not app-level retry-on-conflict.
- Optimistic UI with rollback, matching existing Phase 2/3 pattern.
