# Task Prioritization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can drag-reorder tasks within the Overdue/Today/Upcoming buckets, with a keyboard
alternative, and the underlying sort-key race (audit C3) is fixed atomically at the database level.

**Architecture:** A new Postgres function (`next_sort_key`) replaces the racy read-then-write in
`nextSortKey()`, serializing per-member via an advisory transaction lock. The UI wraps the existing
bucketed task lists in `@hello-pangea/dnd`'s `DragDropContext`/`Droppable`/`Draggable` (already
installed, unused) — one `Droppable` per active bucket, a dedicated drag-handle icon per
`TaskCard` so it doesn't fight the card's three existing 44px action buttons. `onDragEnd` is
extracted as a standalone, unit-testable function that computes neighbor sort keys and calls the
existing `reorderTask()` server action, with optimistic reorder + rollback on failure.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + service-role client),
Jest + React Testing Library, `@hello-pangea/dnd@18.0.1` (already in package.json).

## Global Constraints

- Every server action authenticates (`requireUser()`) and authorizes the specific row/member named
  — no action may rely on a disabled button or a filtered list for access control.
- New Postgres functions: `security definer` + `set search_path = ''` is mandatory, and every table
  reference inside must be schema-qualified (`public.task_assignments`, not `task_assignments`) —
  see `supabase/migrations/007_rls_security_definer.sql` header comment for why.
- No new dependency — `@hello-pangea/dnd@18.0.1` is already in `package.json`, unused.
- Match existing test patterns exactly: `createFakeSupabase` (`src/test/supabase-fake.ts`) is the
  test double for all Supabase calls; do not hand-roll new mocking approaches.
- `member_sort_key` column is `numeric` (see `supabase/migrations/001_initial_schema.sql:55`).

---

### Task 1: Atomic `next_sort_key` Postgres function (fixes audit C3)

**Files:**
- Create: `supabase/migrations/008_atomic_next_sort_key.sql`

**Interfaces:**
- Produces: a Postgres function `public.next_sort_key(p_member_id uuid) returns numeric`, callable
  via `admin.rpc("next_sort_key", { p_member_id: memberId })` from server actions (service_role
  only — not reachable by `anon`/`authenticated`).

- [ ] **Step 1: Write the migration file**

```sql
-- Phase 05 Task 1 — Fix audit C3: nextSortKey() was a read-then-write race (SELECT MAX, then
-- INSERT +1000, as two separate round trips from the app). Two concurrent task creations (or
-- assignee adds) for the same member could read the same MAX and both insert the same key.
--
-- FIX: move the read+compute into a single Postgres function serialized by a per-member advisory
-- transaction lock. Concurrent calls for the SAME member now block on the lock instead of racing;
-- concurrent calls for DIFFERENT members never contend (different lock keys via hashtext).
--
-- Lives in `public` (required so PostgREST exposes it as an RPC endpoint the admin client can
-- call), but EXECUTE is revoked from anon/authenticated and granted only to service_role — the
-- server actions are the only legitimate caller. See 007's header for why an exposed
-- SECURITY DEFINER function must restrict its own grants rather than rely on schema hiding.

create or replace function public.next_sort_key(p_member_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key numeric;
begin
  perform pg_advisory_xact_lock(hashtext(p_member_id::text));

  select coalesce(max(member_sort_key), 0) + 1000
  into v_key
  from public.task_assignments
  where member_id = p_member_id;

  return v_key;
end;
$$;

revoke execute on function public.next_sort_key(uuid) from public;
revoke execute on function public.next_sort_key(uuid) from anon;
revoke execute on function public.next_sort_key(uuid) from authenticated;
grant execute on function public.next_sort_key(uuid) to service_role;
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase migration up` (or the project's existing migration-apply command — check
`package.json` scripts / `docs/workflow.md` if `supabase migration up` is not configured; the
prior 7 migrations in `supabase/migrations/` were applied the same way).

Expected: migration applies with no errors; `next_sort_key` function exists in `public` schema.

- [ ] **Step 3: Manual smoke test via Supabase SQL editor**

Run this in the SQL editor against a member id that has at least one `task_assignments` row:

```sql
select public.next_sort_key('<a real member_id uuid from task_assignments>'::uuid);
```

Expected: returns a numeric value equal to that member's current max `member_sort_key` + 1000.

Note: a true concurrent-race test (firing N simultaneous calls and asserting N distinct results)
needs two live Postgres sessions and isn't reachable from this repo's Jest-only test
infrastructure — there's no pgTAP or integration-test harness here. Record this as a **manual-only
verification item** in Task 7's checklist rather than skipping it silently.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/008_atomic_next_sort_key.sql
git commit -m "feat(05-01): add atomic next_sort_key Postgres function (fixes audit C3)"
```

---

### Task 2: Add `.rpc()` support to the Supabase test fake

**Files:**
- Modify: `src/test/supabase-fake.ts:187-198` (`createFakeSupabase` return object)

**Interfaces:**
- Consumes: nothing new — reads the same `tables` object the fake already holds.
- Produces: `fake.rpc(fnName: string, params: Record<string, unknown>)` returning
  `Promise<{ data: unknown; error: { message: string } | null }>`. Task 3's rewired
  `nextSortKey()` calls this via `admin.rpc("next_sort_key", { p_member_id: memberId })`.

- [ ] **Step 1: Write the failing test**

Add to `src/test/supabase-fake.test.ts` (create this file — the fake currently has no dedicated
test file; if creating it feels like overreach for a one-function addition, this is the right size
because `rpc` is new test-double surface every future action can rely on):

```typescript
import { createFakeSupabase } from "./supabase-fake";

describe("createFakeSupabase — rpc", () => {
  it("next_sort_key returns max(member_sort_key) + 1000 for a member with existing rows", async () => {
    const fake = createFakeSupabase({
      tables: {
        task_assignments: [
          { task_id: "t1", member_id: "m1", member_sort_key: 3000 },
          { task_id: "t2", member_id: "m1", member_sort_key: 1000 },
          { task_id: "t3", member_id: "m2", member_sort_key: 9000 },
        ],
      },
    });

    const { data, error } = await fake.rpc("next_sort_key", { p_member_id: "m1" });

    expect(error).toBeNull();
    expect(data).toBe(4000);
  });

  it("next_sort_key returns 1000 for a member with no existing rows", async () => {
    const fake = createFakeSupabase({ tables: { task_assignments: [] } });

    const { data, error } = await fake.rpc("next_sort_key", { p_member_id: "m-new" });

    expect(error).toBeNull();
    expect(data).toBe(1000);
  });

  it("returns an error for an unknown rpc name", async () => {
    const fake = createFakeSupabase({ tables: {} });

    const { data, error } = await fake.rpc("not_a_real_function", {});

    expect(data).toBeNull();
    expect(error).toEqual({ message: expect.stringContaining("not_a_real_function") });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest supabase-fake.test.ts`
Expected: FAIL — `fake.rpc is not a function`

- [ ] **Step 3: Implement `.rpc()` on the fake**

In `src/test/supabase-fake.ts`, inside `createFakeSupabase`'s returned object (after `from`, before
`auth`):

```typescript
    rpc: async (fnName: string, params: Record<string, unknown>) => {
      if (fnName === "next_sort_key") {
        const memberId = params.p_member_id as string;
        const rows = (tables.task_assignments ?? []) as Row[];
        const max = rows
          .filter((r) => r.member_id === memberId)
          .reduce((acc, r) => Math.max(acc, r.member_sort_key as number), 0);
        return { data: max + 1000, error: null };
      }
      return { data: null, error: { message: `unknown rpc: ${fnName}` } };
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest supabase-fake.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/test/supabase-fake.ts src/test/supabase-fake.test.ts
git commit -m "test(05-02): add rpc() support to Supabase test fake for next_sort_key"
```

---

### Task 3: Rewire `nextSortKey()` to call the atomic RPC

**Files:**
- Modify: `src/app/tasks/actions.ts:80-94` (`nextSortKey` function)
- Test: `src/app/tasks/actions.test.ts` (existing file — extend, don't replace)

**Interfaces:**
- Consumes: `fake.rpc("next_sort_key", { p_member_id })` from Task 2.
- Produces: `nextSortKey(admin, memberId): Promise<number>` — same signature as before, so
  `createTaskWithSubtasks` (L207, L247) and `updateTask` (L315) call sites need no changes.

- [ ] **Step 1: Write the failing test**

Add to `src/app/tasks/actions.test.ts`, in the existing `describe("createTaskWithSubtasks", ...)`
block (find it via the existing tests around assignee creation) — add:

```typescript
  it("computes each assignee's sort key via the next_sort_key rpc, not a stale read", async () => {
    const tables = seed();
    tables.task_assignments.push({ task_id: T_OTHER, member_id: M1, member_sort_key: 5000 });
    const fake = setup({ tables });

    const rpcSpy = jest.spyOn(fake, "rpc");

    await createTaskWithSubtasks({
      title: "New task",
      workspaceId: WS1,
      memberIds: [M1],
      subtasks: [],
    });

    expect(rpcSpy).toHaveBeenCalledWith("next_sort_key", { p_member_id: M1 });
    const newAssignment = assignmentsIn(fake.tables).find(
      (a) => a.member_id === M1 && a.member_sort_key === 6000
    );
    expect(newAssignment).toBeDefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest actions.test.ts -t "next_sort_key rpc"`
Expected: FAIL — `rpcSpy` never called (current `nextSortKey` uses `.from().select()`, not `.rpc()`)

- [ ] **Step 3: Rewire the implementation**

Replace `nextSortKey` in `src/app/tasks/actions.ts` (lines 80-94):

```typescript
/** Next sort key for a member, computed atomically in Postgres. See migration 008 (audit C3). */
async function nextSortKey(
  admin: ReturnType<typeof createAdminClient>,
  memberId: string
): Promise<number> {
  const { data, error } = await admin.rpc("next_sort_key", { p_member_id: memberId });
  if (error) throw new Error(`next sort key: ${error.message}`);
  return data as number;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest actions.test.ts`
Expected: PASS — all existing `createTaskWithSubtasks`/`updateTask` tests plus the new one.

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/actions.ts src/app/tasks/actions.test.ts
git commit -m "fix(05-03): call atomic next_sort_key rpc instead of read-then-write"
```

---

### Task 4: `computeNeighborKeys` pure helper

**Files:**
- Create: `src/app/tasks/reorder-helpers.ts`
- Test: `src/app/tasks/reorder-helpers.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `computeNeighborKeys(bucket: { member_sort_key: number }[], toIndex: number): { prevKey: number | null; nextKey: number | null }`
  — Task 6's `onDragEnd` calls this with the bucket array *after* the dragged item has been
  spliced into `toIndex`, and feeds the result straight into `reorderTask()`'s existing
  `prevKey`/`nextKey` params (`reorderTaskSchema` already expects exactly this shape).

- [ ] **Step 1: Write the failing tests**

```typescript
import { computeNeighborKeys } from "./reorder-helpers";

describe("computeNeighborKeys", () => {
  const bucket = [
    { member_sort_key: 1000 },
    { member_sort_key: 2000 },
    { member_sort_key: 3000 },
  ];

  it("returns null prevKey when dropped at the start", () => {
    // dragged item is now at index 0; bucket[1] (2000) is the new next neighbor
    const result = computeNeighborKeys(
      [{ member_sort_key: -1 }, ...bucket.slice(1)],
      0
    );
    expect(result).toEqual({ prevKey: null, nextKey: 2000 });
  });

  it("returns null nextKey when dropped at the end", () => {
    const arr = [...bucket.slice(0, 2), { member_sort_key: -1 }];
    const result = computeNeighborKeys(arr, 2);
    expect(result).toEqual({ prevKey: 2000, nextKey: null });
  });

  it("returns both neighbors when dropped in the middle", () => {
    const arr = [bucket[0], { member_sort_key: -1 }, bucket[2]];
    const result = computeNeighborKeys(arr, 1);
    expect(result).toEqual({ prevKey: 1000, nextKey: 3000 });
  });

  it("returns null/null for a single-item bucket", () => {
    const result = computeNeighborKeys([{ member_sort_key: -1 }], 0);
    expect(result).toEqual({ prevKey: null, nextKey: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest reorder-helpers.test.ts`
Expected: FAIL — `Cannot find module './reorder-helpers'`

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Given a bucket array with the dragged task already spliced into `toIndex`, returns the
 * member_sort_key of its new neighbors — direct input to reorderTask()'s prevKey/nextKey.
 */
export function computeNeighborKeys(
  bucket: { member_sort_key: number }[],
  toIndex: number
): { prevKey: number | null; nextKey: number | null } {
  const prevKey = toIndex > 0 ? bucket[toIndex - 1].member_sort_key : null;
  const nextKey = toIndex < bucket.length - 1 ? bucket[toIndex + 1].member_sort_key : null;
  return { prevKey, nextKey };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest reorder-helpers.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/reorder-helpers.ts src/app/tasks/reorder-helpers.test.ts
git commit -m "feat(05-04): add computeNeighborKeys pure helper for drag reorder"
```

---

### Task 5: Drag handle in `TaskCard`

**Files:**
- Modify: `src/components/task-card.tsx:32-127` (`TaskCard` component)
- Test: `src/components/__tests__/task-card.test.tsx` (existing file — extend)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `TaskCard` accepts an optional `dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>`
  prop. When provided, renders a 44×44px grip-icon button with those props spread onto it (this is
  where Task 6 will pass `@hello-pangea/dnd`'s `DraggableProvidedDragHandleProps`). When omitted
  (e.g. in `CompletedSection`, which never reorders), no handle renders and layout is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/components/__tests__/task-card.test.tsx`:

```typescript
  it("renders a drag handle when dragHandleProps is provided", () => {
    render(
      <TaskCard
        taskId="t1"
        title="Task 1"
        workspace="Home"
        dragHandleProps={{ "aria-describedby": "drag-instructions" } as React.HTMLAttributes<HTMLButtonElement>}
      />
    );
    const handle = screen.getByLabelText('Reorder "Task 1"');
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveAttribute("aria-describedby", "drag-instructions");
  });

  it("renders no drag handle when dragHandleProps is omitted", () => {
    render(<TaskCard taskId="t1" title="Task 1" workspace="Home" />);
    expect(screen.queryByLabelText('Reorder "Task 1"')).not.toBeInTheDocument();
  });
```

(Check the top of the test file for existing `render`/`screen` imports from
`@testing-library/react` — reuse them, don't re-import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest task-card.test.tsx -t "drag handle"`
Expected: FAIL — `dragHandleProps` prop doesn't exist yet, `getByLabelText` finds nothing

- [ ] **Step 3: Add the drag handle**

In `src/components/task-card.tsx`, add `dragHandleProps` to the props type (after `onEdit`):

```typescript
  onEdit?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
```

Add the handle as the first child inside the `<div className="flex items-center gap-3">` row
(before the complete button), so it reads first in tab order:

```typescript
        {dragHandleProps && (
          <button
            type="button"
            aria-label={`Reorder "${title}"`}
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-text-muted)] cursor-grab active:cursor-grabbing"
            {...dragHandleProps}
          >
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
              <circle cx="2.5" cy="2.5" r="1.5" />
              <circle cx="7.5" cy="2.5" r="1.5" />
              <circle cx="2.5" cy="8" r="1.5" />
              <circle cx="7.5" cy="8" r="1.5" />
              <circle cx="2.5" cy="13.5" r="1.5" />
              <circle cx="7.5" cy="13.5" r="1.5" />
            </svg>
          </button>
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest task-card.test.tsx`
Expected: PASS — new tests plus all existing `task-card.test.tsx` tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/components/task-card.tsx src/components/__tests__/task-card.test.tsx
git commit -m "feat(05-05): add optional drag handle to TaskCard"
```

---

### Task 6: Wire drag-and-drop into `TasksPageClient`

**Files:**
- Modify: `src/app/tasks/tasks-page-client.tsx`
- Test: `src/app/tasks/tasks-page-client.test.tsx` (existing file — extend)

**Interfaces:**
- Consumes: `computeNeighborKeys` (Task 4), `TaskCard`'s `dragHandleProps` (Task 5), the existing
  `reorderTask` action, the existing `memberIdByWorkspaceId` prop (already threaded through from
  `page.tsx:75-76,162` — per-workspace member id, since a task's `reorderTask` call needs the
  *current user's member id in that task's workspace*, not a single global id).
- Produces: an exported `buildDragEndHandler` function (kept separate from the component so it's
  testable without simulating real pointer/keyboard sensor events) that
  `TasksPageClient` wires to `DragDropContext`'s `onDragEnd`.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/tasks/tasks-page-client.test.tsx`. First check the top of the file for its existing
render helper / fixture shape (it already renders `TasksPageClient` with a `workspaces` array,
`memberIdByWorkspaceId`, and `initialTasks` — reuse that setup, don't rebuild it). Add:

```typescript
  it("reorders within a bucket and calls reorderTask with computed neighbor keys", async () => {
    (reorderTask as jest.Mock).mockResolvedValue({ ok: true });
    const tasks = [
      makeTask({ id: "t1", member_sort_key: 1000, due_at: null }), // upcoming bucket
      makeTask({ id: "t2", member_sort_key: 2000, due_at: null }),
      makeTask({ id: "t3", member_sort_key: 3000, due_at: null }),
    ];
    render(<TasksPageClient {...baseProps} initialTasks={tasks} />);

    fireEvent.dragEnd(screen.getByTestId("drag-context"), {
      // Simulated at the handler level, not real @hello-pangea/dnd sensors — see Step 3 note.
    });
    // See Step 3: tests call `buildDragEndHandler` directly rather than simulating real DnD
    // pointer events, which @hello-pangea/dnd's own test suite recommends over end-to-end
    // simulation (its sensors are not designed to be triggered by synthetic DOM events).
  });
```

Replace that sketch with the actual approach — call the exported handler directly:

```typescript
import { buildDragEndHandler } from "./tasks-page-client";

describe("buildDragEndHandler", () => {
  const M1 = "b0000000-0000-4000-8000-000000000001";
  const WS1 = "a0000000-0000-4000-8000-000000000001";

  function bucketTask(id: string, sortKey: number) {
    return {
      id,
      title: id,
      due_at: null,
      completed_at: null,
      workspace: { id: WS1, name: "Home", kind: "household" },
      member_sort_key: sortKey,
      assignee_count: 1,
      member_ids: [M1],
      subtasks: [],
    };
  }

  it("calls reorderTask with computed neighbor keys on a same-bucket move", async () => {
    const localTasks = [bucketTask("t1", 1000), bucketTask("t2", 2000), bucketTask("t3", 3000)];
    const setLocalTasks = jest.fn();
    const handleReorderError = jest.fn();

    const handler = buildDragEndHandler({
      localTasks,
      memberIdByWorkspaceId: { [WS1]: M1 },
      setLocalTasks,
      onReorderError: handleReorderError,
    });

    await handler({
      draggableId: "t1",
      source: { droppableId: "Upcoming", index: 0 },
      destination: { droppableId: "Upcoming", index: 2 },
      reason: "DROP",
    } as import("@hello-pangea/dnd").DropResult);

    expect(reorderTask).toHaveBeenCalledWith({
      taskId: "t1",
      memberId: M1,
      prevKey: 3000,
      nextKey: null,
    });
    expect(setLocalTasks).toHaveBeenCalled(); // optimistic splice happened
  });

  it("no-ops on a cross-bucket move", async () => {
    const localTasks = [bucketTask("t1", 1000), bucketTask("t2", 2000)];
    const setLocalTasks = jest.fn();

    const handler = buildDragEndHandler({
      localTasks,
      memberIdByWorkspaceId: { [WS1]: M1 },
      setLocalTasks,
      onReorderError: jest.fn(),
    });

    await handler({
      draggableId: "t1",
      source: { droppableId: "Today", index: 0 },
      destination: { droppableId: "Upcoming", index: 0 },
      reason: "DROP",
    } as import("@hello-pangea/dnd").DropResult);

    expect(reorderTask).not.toHaveBeenCalled();
    expect(setLocalTasks).not.toHaveBeenCalled();
  });

  it("reverts the optimistic order and reports the error when reorderTask fails", async () => {
    (reorderTask as jest.Mock).mockResolvedValue({ ok: false, error: "server exploded" });
    const localTasks = [bucketTask("t1", 1000), bucketTask("t2", 2000)];
    const setLocalTasks = jest.fn();
    const onReorderError = jest.fn();

    const handler = buildDragEndHandler({
      localTasks,
      memberIdByWorkspaceId: { [WS1]: M1 },
      setLocalTasks,
      onReorderError,
    });

    await handler({
      draggableId: "t1",
      source: { droppableId: "Today", index: 0 },
      destination: { droppableId: "Today", index: 1 },
      reason: "DROP",
    } as import("@hello-pangea/dnd").DropResult);

    // setLocalTasks called twice: once for the optimistic splice, once for the revert
    expect(setLocalTasks).toHaveBeenCalledTimes(2);
    expect(onReorderError).toHaveBeenCalledWith("server exploded");
  });
});
```

Also add near the top of the test file (with the other `jest.mock` calls):

```typescript
jest.mock("./actions", () => ({
  ...jest.requireActual("./actions"),
  reorderTask: jest.fn(),
}));
```

Check the existing top of `tasks-page-client.test.tsx` first — if `./actions` is already partially
mocked for `completeTask`/`deleteTask`, add `reorderTask: jest.fn()` to that existing mock object
instead of creating a second one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tasks-page-client.test.tsx -t "buildDragEndHandler"`
Expected: FAIL — `buildDragEndHandler` is not exported yet.

- [ ] **Step 3: Implement `buildDragEndHandler` and wire the DnD components**

In `src/app/tasks/tasks-page-client.tsx`, add imports:

```typescript
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { reorderTask } from "./actions";
import { computeNeighborKeys } from "./reorder-helpers";
```

Add this exported function above `TasksPageClient` (pure-ish orchestration, no React state inside
— it receives setters as params so it's callable from tests without rendering):

```typescript
/**
 * Extracted from the component so it's testable by calling it directly with a fabricated
 * DropResult, rather than simulating real @hello-pangea/dnd pointer/keyboard sensor events —
 * the library's own tests take the same approach; its sensors aren't designed to be triggered
 * by synthetic DOM events.
 */
export function buildDragEndHandler({
  localTasks,
  memberIdByWorkspaceId,
  setLocalTasks,
  onReorderError,
}: {
  localTasks: RawTask[];
  memberIdByWorkspaceId: Record<string, string>;
  setLocalTasks: (updater: (prev: RawTask[]) => RawTask[]) => void;
  onReorderError: (message: string) => void;
}) {
  return async function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId !== destination.droppableId) return;
    if (source.index === destination.index) return;

    const bucketId = source.droppableId;
    const bucketTasks = localTasks.filter((t) => bucketOf(t) === bucketId);
    const dragged = bucketTasks.find((t) => t.id === draggableId);
    if (!dragged) return;

    const withoutDragged = bucketTasks.filter((t) => t.id !== draggableId);
    const reordered = [
      ...withoutDragged.slice(0, destination.index),
      dragged,
      ...withoutDragged.slice(destination.index),
    ];
    const { prevKey, nextKey } = computeNeighborKeys(reordered, destination.index);

    const previousOrder = localTasks;

    // Optimistic move: give the dragged task a synthetic sort key placed between its new
    // neighbors so bucketTasks()'s existing member_sort_key sort reflects the drop immediately,
    // before the server confirms. This is the single state update for the optimistic phase —
    // bucketTasks() re-sorts by member_sort_key on every render, so reassigning just this one
    // task's key is sufficient to move it; no manual array-splice-into-place is needed.
    const optimisticKey =
      prevKey !== null && nextKey !== null
        ? (prevKey + nextKey) / 2
        : prevKey !== null
          ? prevKey + 1000
          : nextKey !== null
            ? nextKey - 1000
            : dragged.member_sort_key;
    setLocalTasks(() =>
      localTasks.map((t) => (t.id === draggableId ? { ...t, member_sort_key: optimisticKey } : t))
    );

    const memberId = memberIdByWorkspaceId[dragged.workspace.id];
    const res = await reorderTask({ taskId: draggableId, memberId, prevKey, nextKey });

    if (!res.ok) {
      setLocalTasks(() => previousOrder);
      onReorderError(res.error ?? "Failed to reorder task");
    }
  };
}

function bucketOf(task: RawTask): "Overdue" | "Today" | "Upcoming" | "Completed" {
  if (task.completed_at) return "Completed";
  if (!task.due_at) return "Upcoming";
  const dueStr = task.due_at.slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  if (dueStr < todayStr) return "Overdue";
  if (dueStr === todayStr) return "Today";
  return "Upcoming";
}
```

Note: `bucketOf` mirrors `bucketTasks()`'s own classification in `bucket-tasks.ts` — it must
produce the same bucket assignment `bucketTasks` would, since `onDragEnd`'s `source.droppableId`
is one of the same three bucket-name strings rendered as `Droppable` ids. This is intentionally a
small duplication of `bucketTasks`'s if/else, not a call into it, because `bucketTasks` computes
`deadlineLabel`/`deadlineVariant` too and returns `BucketedTask`, not a plain bucket-name lookup —
pulling that apart into a shared classifier is more churn than this needs right now (YAGNI); if a
third caller needs bucket classification later, extract then.

Now wire the JSX. Inside `TasksPageClient`, add the error toast wiring near the other handlers:

```typescript
  function handleReorderError(message: string) {
    toast(message, "error");
  }
```

(Add `import { toast } from "@/components/toaster";` to the existing imports at the top of the
file if not already present — check first, `TaskCard` already imports it but `tasks-page-client.tsx`
may not.)

Replace the bucket-rendering block (the `.map(({ key, tasks: sectionTasks }) => ...)` at
lines 248-282) with a `DragDropContext`-wrapped version:

```typescript
              <DragDropContext
                onDragEnd={buildDragEndHandler({
                  localTasks,
                  memberIdByWorkspaceId,
                  setLocalTasks,
                  onReorderError: handleReorderError,
                })}
              >
                {(
                  [
                    { key: "Overdue", tasks: overdue },
                    { key: "Today", tasks: today },
                    { key: "Upcoming", tasks: upcoming },
                  ] as const
                ).map(({ key, tasks: sectionTasks }) => {
                  if (!sectionTasks.length) return null;
                  return (
                    <div key={key} className="mb-6">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
                        {key}
                      </p>
                      <Droppable droppableId={key}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className="flex flex-col gap-1.5"
                          >
                            {sectionTasks.map((task, index) => (
                              <Draggable key={task.id} draggableId={task.id} index={index}>
                                {(dragProvided) => (
                                  <div
                                    ref={dragProvided.innerRef}
                                    {...dragProvided.draggableProps}
                                    className={optimisticTaskIds.has(task.id) ? "opacity-40" : undefined}
                                  >
                                    <TaskCard
                                      taskId={task.id}
                                      title={task.title}
                                      deadline={task.deadlineLabel}
                                      deadlineVariant={task.deadlineVariant}
                                      workspace={task.workspace.name}
                                      shared={task.shared}
                                      subtasks={task.subtasks}
                                      onEdit={() => setEditingTask(task)}
                                      dragHandleProps={dragProvided.dragHandleProps ?? undefined}
                                    />
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  );
                })}
              </DragDropContext>
```

The `CompletedSection` block immediately after stays exactly as-is — Completed is not wrapped in
`Droppable`/`Draggable`, matching the "Completed is not reorderable" scope decision.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tasks-page-client.test.tsx`
Expected: PASS — new `buildDragEndHandler` tests plus all pre-existing tests in this file
unaffected (drag/drop JSX wrapping doesn't change what non-drag tests assert on).

- [ ] **Step 5: Run the full suite and build to catch integration issues**

Run: `npm test && npm run build`
Expected: all suites green, build compiles clean (this file is imported by `page.tsx`, and
`@hello-pangea/dnd` needs to tree-shake/compile fine under Turbopack — confirm here rather than
discovering it later).

- [ ] **Step 6: Commit**

```bash
git add src/app/tasks/tasks-page-client.tsx src/app/tasks/tasks-page-client.test.tsx
git commit -m "feat(05-06): wire drag-to-reorder into TasksPageClient"
```

---

### Task 7: Manual verification checklist

**Files:**
- Create: `.planning/phases/05-task-prioritization/05-VERIFICATION.md`

**Interfaces:** none — this is a documentation-only task, no code.

- [ ] **Step 1: Check whether the phase directory exists**

Run: `ls .planning/phases/ | grep 05`

If `.planning/phases/05-task-prioritization/` doesn't exist yet (this plan was written via
superpowers, not `/gsd-plan-phase`, so it may not), create it:
`mkdir -p .planning/phases/05-task-prioritization`

- [ ] **Step 2: Write the checklist**

```markdown
---
phase: 05-task-prioritization
status: pending
---

# Phase 5 — Manual Verification Checklist

> Checks that can't be automated with this repo's Jest-only test infrastructure. Fill in Result
> and flip `status: pending` → `status: complete` once all pass. Same pattern as
> `.planning/phases/04-accessibility-mobile/04-VERIFICATION.md`.

| # | Behavior | Why Manual | Test Instructions | Result |
|---|----------|-------------|--------------------|--------|
| 1 | Keyboard reorder (Space to lift, arrows to move, Space to drop, Escape to cancel) | `@hello-pangea/dnd`'s real keyboard sensor isn't meaningfully unit-testable — it listens to real `keydown` events with its own internal state machine | Run `npm run dev`. Tab to a task card's drag handle (grip icon). Press Space to lift it — confirm a "you have lifted an item" style live-region announcement (the library provides this by default). Press Arrow Down/Up to move it within the bucket. Press Space to drop — confirm the task's new position persists after a page refresh. Press Escape mid-lift on another task — confirm it cancels and the task returns to its original position. | ⬜ pending |
| 2 | Mouse/touch drag on a real device | Automated tests call `buildDragEndHandler` directly (see `tasks-page-client.test.tsx`), not through real pointer sensors | On a touch device or with a mouse, drag a task card by its handle to a new position within the same bucket. Confirm it moves instantly (optimistic) and stays after refresh. Attempt to drag a card from one bucket into another — confirm it snaps back (cross-bucket is out of scope, disabled at the handler level). | ⬜ pending |
| 3 | `next_sort_key` concurrency (audit C3 regression check) | No pgTAP/integration-test harness exists in this repo to fire real concurrent Postgres sessions | Open two Supabase SQL editor tabs. In both, prepare (but don't yet run) `select public.next_sort_key('<same member_id>'::uuid);`. Execute both as close to simultaneously as possible. Confirm the two returned values are different (not both `max+1000` for the same stale max) — this proves the advisory lock serialized them. | ⬜ pending |

## Sign-off

- [ ] All three checks recorded pass
- [ ] `status: complete` set in frontmatter above
```

- [ ] **Step 3: Commit**

```bash
git add .planning/phases/05-task-prioritization/05-VERIFICATION.md
git commit -m "docs(05-07): add manual verification checklist for task prioritization"
```

---

## Self-Review Notes

- **Spec coverage:** C3 fix (Task 1+2+3), within-bucket drag (Task 6), keyboard alternative (built
  into `@hello-pangea/dnd`, verified manually in Task 7), optimistic UI + rollback (Task 6), no
  cross-bucket drag (Task 6's `source.droppableId !== destination.droppableId` guard, tested),
  Completed bucket excluded (Task 6 — `CompletedSection` untouched), pure helper testing (Task 4).
  All spec sections have a task.
- **Deviation from spec surfaced during planning:** the spec's "concurrency test" for C3 assumed
  some form of automatable regression test; this repo has no pgTAP/integration harness for real
  concurrent Postgres sessions, so it's a manual-only item (Task 7, item 3) instead — flagged
  inline in Task 1 rather than silently downgraded.
- **Type consistency check:** `computeNeighborKeys`'s `{ prevKey, nextKey }` return shape matches
  `reorderTaskSchema`'s `prevKey`/`nextKey` fields exactly (both `number | null`). `TaskCard`'s new
  `dragHandleProps` type matches what `Draggable`'s render prop provides
  (`DraggableProvidedDragHandleProps | null`, narrowed with `?? undefined` at the call site since
  `TaskCard`'s prop is typed as `React.HTMLAttributes<HTMLButtonElement>` rather than the DnD-
  specific type — keeps `task-card.tsx` free of a `@hello-pangea/dnd` import for a component that
  has nothing else to do with drag internals).
