# Phase 2: Task Creation - Research

**Researched:** 2026-03-27
**Domain:** Task creation modal, server actions, optimistic state management, real-time list updates
**Confidence:** HIGH

## Summary

Phase 2 requires implementing optimistic task creation with instant list appearance. The server action `createTaskWithSubtasks` is already fully implemented and tested. The modal UI is complete and handles all fields. The primary work is integrating optimistic state management in the client component (`tasks-page-client.tsx`) to display tasks immediately before server confirmation, with smart bucket placement mirroring the server-side logic.

The requirements are well-defined in CONTEXT.md decisions: optimistic insert with immediate modal close, creator auto-selection as assignee, submit block if no assignees, workspace switching resets assignees, and clear rollback on server error. All pieces exist — this phase orchestrates them into a seamless user experience.

**Primary recommendation:** Implement optimistic state in `tasks-page-client.tsx` via a callback from the modal that adds a pending task to local state with client-side bucket placement. Audit the existing server action for field coverage and edge cases. Write tests RED-first following the existing test patterns in `actions.test.ts` and `new-task-modal.test.tsx`.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **Instant appearance via optimistic insert**
   - Task appears in list immediately when submit is clicked (before server response)
   - Modal closes immediately — no waiting for server confirmation
   - Smart bucket placement: client-side logic mirrors server `bucket-tasks.ts` rules (overdue/today/upcoming by due date)
   - On server error: remove optimistic task + show error toast, clean rollback

2. **Post-create feedback**
   - Success toast: "Task created" fires after optimistic insert
   - If subtasks partially fail: warning toast "Task created, but N subtask(s) could not be saved"
   - No duplicate success toast for the subtask warning path

3. **Assignee defaults and validation**
   - Creator always pre-selected when modal opens
   - Submit blocked if no assignee is selected (enforces visibility)
   - Switching workspace resets assignee selection to creator's member ID in the new workspace

4. **Subtasks in create modal**
   - Keep subtasks in modal — already built and working
   - Phase 3 (task detail) extends subtask management

5. **Tests**
   - Server action: `createTaskWithSubtasks` coverage (fields, assignment, error, subtask partial failure)
   - Modal component: renders, submits, validation, toggles, workspace reset, error handling
   - TDD approach: tests RED first, then implement GREEN

### Claude's Discretion

- Exact optimistic placeholder styling (pending visual treatment)
- Loading state on submit button during round-trip
- Exact bucket assignment logic implementation (can mirror server-side)

### Deferred Ideas (OUT OF SCOPE)

- None surfaced — all ideas stayed in Phase 2 scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TASK-01 | User can create a task with title, optional description, optional due date, workspace, and one or more assignees | Server action `createTaskWithSubtasks` handles all fields; modal UI complete and validated; this phase adds optimistic state management |
| TASK-02 | Newly created task appears immediately in the task list without page reload | Optimistic insert in client state + smart bucket placement via `bucketTasks` logic mirror; server `revalidatePath` triggers background refresh; no manual reload needed |

</phase_requirements>

## Standard Stack

### Core Libraries (Verified Current)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| next | 16.1.6 | App Router, server/client boundary | In use |
| react | 19.0.0 | Component framework, hooks (useTransition, useState) | In use |
| typescript | 5 | Type safety | In use |
| @supabase/supabase-js | 2.98.0 | Database client (browser) | In use |
| jest | 30.3.0 | Test framework | In use |
| @testing-library/react | 16.3.2 | Component testing | In use |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @supabase/ssr | 0.9.0 | Server-side auth + cookie handling | Already configured in `lib/supabase/server.ts` |
| tailwindcss | 4 | CSS utility framework + custom properties | Styling via `--color-*` tokens in `globals.css` |
| @testing-library/jest-dom | 6.9.1 | Jest matchers for DOM testing | In test setup |

### No Alternatives Needed

This phase does not require new libraries. All foundational pieces exist:
- **Server actions:** `createTaskWithSubtasks` in `actions.ts` (handles title, description, dueAt, workspaceId, memberIds, subtasks)
- **Modal UI:** `new-task-modal.tsx` (complete form with all fields)
- **Client rendering:** `tasks-page-client.tsx` (receives workspaces/currentMemberIds, manages modal state)
- **Bucket logic:** `bucket-tasks.ts` (deterministic TODAY/UPCOMING/OVERDUE bucketing)
- **Testing:** Jest + React Testing Library (established patterns in `actions.test.ts`, `new-task-modal.test.tsx`)

## Architecture Patterns

### Optimistic State Management Pattern

The standard pattern for this phase:

1. **User submits form** → `handleSubmit` calls server action via `useTransition`
2. **Immediately (optimistic):**
   - Generate a temporary task object with `{ id, title, due_at, completed_at: null, workspace, member_sort_key, assignee_count }`
   - Call a callback prop (e.g., `onTaskCreated`) passed from `tasks-page-client.tsx`
   - In the parent, insert the temporary task into local state in the correct bucket using `bucketTasks` logic
   - Show success toast
   - Modal closes immediately (via `onClose()`)
3. **Server completes:**
   - If successful: replace temporary ID with real ID (or confirm and move on)
   - If error: remove from local state, show error toast
4. **Background refresh:** `revalidatePath("/tasks")` in server action triggers Next.js cache revalidation

**Why this pattern:**
- Instant user feedback (no 500ms round-trip latency)
- Matches current practices (modal already uses `useTransition`)
- Bucket logic is deterministic (same code path on client and server)
- Clean rollback: temporary state is isolated

### Recommended Project Structure (Unchanged)

```
src/app/tasks/
├── page.tsx              # Server component (fetches tasks, passes to TasksPageClient)
├── actions.ts            # Server actions (createTaskWithSubtasks, completeTask, deleteTask)
├── tasks-page-client.tsx # Client shell with modal state (ADD optimistic state here)
├── new-task-modal.tsx    # Modal form (already complete, pass onTaskCreated callback)
├── bucket-tasks.ts       # Bucket logic (reusable for client-side optimistic placement)
├── completed-section.tsx # Completed tasks section
├── tab-pill.tsx          # Tab navigation
└── *.test.ts            # Test files
```

**Key change:** Add optimistic state management to `tasks-page-client.tsx`:
- Maintain local state for tasks (mirroring server state)
- When modal submits, insert optimistic task before server response
- Wire `NewTaskModal` to call `onTaskCreated` callback after optimistic insert
- On error, remove from local state

### Pattern 1: Optimistic Insert with Bucket Placement

**What:** Client-side task creation with instant visual feedback before server confirmation.

**When to use:** Any form submission that should feel instant to the user (search, create, update).

**Example:**

```typescript
// In tasks-page-client.tsx (ADD THIS)
"use client";

import { useState } from "react";
import { bucketTasks, type RawTask, type BucketedTask } from "./bucket-tasks";

export function TasksPageClient({
  workspaces,
  currentMemberIds,
  workspaceFilter,
  viewFilter,
  initialTasks, // Passed from server component
  children,
}: {
  workspaces: Workspace[];
  currentMemberIds: string[];
  workspaceFilter?: string;
  viewFilter?: string;
  initialTasks: RawTask[];
  children: React.ReactNode;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [localTasks, setLocalTasks] = useState<RawTask[]>(initialTasks);
  const [optimisticTaskIds, setOptimisticTaskIds] = useState<Set<string>>(new Set());
  const hasWorkspace = workspaces.length > 0;

  // Called by modal after optimistic insert
  function handleTaskCreated(newTask: RawTask) {
    setLocalTasks((prev) => [...prev, newTask]);
    setOptimisticTaskIds((prev) => new Set([...prev, newTask.id]));
  }

  // On server error (from modal)
  function handleTaskError(taskId: string) {
    setLocalTasks((prev) => prev.filter((t) => t.id !== taskId));
    setOptimisticTaskIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }

  // Apply same filters and bucketing as server
  const filtered = localTasks.filter((t) => {
    if (workspaceFilter && t.workspace.kind !== workspaceFilter) return false;
    if (viewFilter === "shared" && t.assignee_count <= 1) return false;
    return true;
  });

  const { overdue, today, upcoming, completed } = bucketTasks(filtered);

  return (
    <>
      <NewTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        workspaces={workspaces}
        currentMemberIds={currentMemberIds}
        onTaskCreated={handleTaskCreated}
        onError={handleTaskError}
      />
      {/* Rest of layout... */}
    </>
  );
}
```

```typescript
// In new-task-modal.tsx (MODIFY handleSubmit)
function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  if (!title.trim() || !workspaceId || selectedMemberIds.length === 0) return;

  // Generate optimistic task BEFORE calling server action
  const optimisticId = `optimistic-${Date.now()}`;
  const optimisticTask: RawTask = {
    id: optimisticId,
    title: title.trim(),
    due_at: dueAt || null,
    completed_at: null,
    workspace: workspaces.find(w => w.id === workspaceId)!,
    member_sort_key: 0, // Will be replaced when server confirms
    assignee_count: selectedMemberIds.length,
  };

  startTransition(async () => {
    try {
      // Optimistic update BEFORE server response
      onTaskCreated(optimisticTask);
      toast("Task created");

      // Server action
      const { subtaskErrors } = await createTaskWithSubtasks({
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt: dueAt || undefined,
        workspaceId,
        memberIds: selectedMemberIds,
        subtasks: subtaskRows
          .filter((r) => r.title.trim())
          .map((r) => ({ title: r.title.trim(), dueAt: r.dueAt || undefined })),
      });

      if (subtaskErrors > 0) {
        toast(`Task created, but ${subtaskErrors} subtask(s) could not be saved`, "warning");
      }

      resetForm();
      onClose();
    } catch (error) {
      // On error, remove optimistic task
      onError(optimisticId);
      toast("Failed to create task", "error");
    }
  });
}
```

**Key insight:** Bucket logic (`bucketTasks`) is deterministic and stateless. Running it client-side and server-side on the same task set yields identical results. No special per-user bucketing or dynamic state needed.

### Pattern 2: Creator Auto-Selection

**What:** Modal pre-selects the current user as an assignee.

**When to use:** Any creation form where the actor should be included in the result by default.

**Current implementation in `new-task-modal.tsx`:**

```typescript
const getInitialMembers = (wsId: string) =>
  workspaces.find((w) => w.id === wsId)?.members
    .filter((m) => currentMemberIds.includes(m.id))  // Only user's members in this workspace
    .map((m) => m.id) ?? [];

const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(
  getInitialMembers(firstWorkspace?.id ?? "")
);

function handleWorkspaceChange(id: string) {
  setWorkspaceId(id);
  setSelectedMemberIds(getInitialMembers(id));  // Reset to current user's member in new workspace
}
```

**Status:** Already implemented. No changes needed.

### Anti-Patterns to Avoid

- **Waiting for server before closing modal:** Creates perceived lag. Optimistic UI is the pattern here.
- **Custom bucket logic instead of reusing `bucketTasks`:** Risks desync between client and server. The function is pure and portable.
- **Silent error handling:** Always show error toasts so users know what failed. See CONTEXT.md STATE.md note about `completeTask()/deleteTask()` silent errors.
- **Forgetting to dedup memberIds:** Server action already does this with `[...new Set(memberIds)]`. Modal should not re-dedup (or can, it's idempotent).
- **Sort key as 0 for optimistic tasks:** Temporary sort keys don't matter — they're replaced when server confirms. Using 0 is fine. Avoid trying to calculate "next" sort key on client (racy).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Task creation form | Custom form logic | `new-task-modal.tsx` + `createTaskWithSubtasks` action | Modal already built; action fully tested with field coverage, error handling, subtask retry |
| Bucket assignment | Custom date logic to place tasks | `bucketTasks()` function in `bucket-tasks.ts` | Pure, deterministic, reusable on client and server; handles edge cases (midnight today, hour precision, no-due-date tasks) |
| Test mocking | Manual jest.fn() chains per test | Reuse `makeSortKeyMock()` helper from `actions.test.ts` | Reduces test boilerplate; ensures sort key query structure stays consistent |
| RLS enforcement | Custom auth checks in component | Trust server action + admin client | Server action uses admin client (bypasses RLS for legitimate reads); RLS policies on tables enforce data boundaries. No per-task auth checks needed in component. |
| Component state management | Redux/Zustand for task list | useState + local state | List is filtered from server data, optimistic updates are temporary. No global state needed. |

**Key insight:** This phase is primarily orchestration of existing pieces. The main "build" is the optimistic state integration in `tasks-page-client.tsx`. Everything else is wiring and testing.

## Common Pitfalls

### Pitfall 1: Optimistic ID Collision

**What goes wrong:** Temporary IDs (e.g., `optimistic-${Date.now()}`) conflict with real IDs if the same user creates tasks in rapid succession.

**Why it happens:** `Date.now()` has millisecond granularity. Multiple clicks within a millisecond = same ID. Real IDs are UUIDs.

**How to avoid:**
- Use `optimistic-${Date.now()}-${Math.random()}` for better uniqueness.
- Better: use `crypto.randomUUID()` (browser API, all modern browsers).
- Store optimistic IDs in a Set for cleanup.

**Warning signs:** Two "new" tasks appear in list with same ID. Click-spam creates a task twice visually.

### Pitfall 2: Bucket Logic Drift Between Client and Server

**What goes wrong:** Optimistic task appears in the wrong bucket (e.g., "Today" on client, "Upcoming" on server). After server returns, task jumps buckets.

**Why it happens:** Duplicating `bucket-tasks.ts` logic inline instead of reusing. Different timezone handling, different date math, different condition order.

**How to avoid:**
- Import `bucketTasks()` directly from `bucket-tasks.ts` in the modal or client component.
- Use the same `RawTask` type and `now` parameter (default `new Date()` is fine).
- Never rewrite the bucketing logic.

**Warning signs:** Visual glitch on task creation. Bucket sections appear/disappear.

### Pitfall 3: Forgetting to Handle Subtask Partial Failure

**What goes wrong:** Parent task appears in list, but no warning shown about failed subtasks.

**Why it happens:** `createTaskWithSubtasks` returns `{ subtaskErrors: number }` but the modal doesn't handle it.

**How to avoid:**
- Check `subtaskErrors > 0` in the modal's try block.
- Show warning toast: `Task created, but ${subtaskErrors} subtask(s) could not be saved` (CONTEXT.md decision).
- Do NOT show a second success toast (warning toast covers it).

**Current implementation:** Already correct in `new-task-modal.tsx` lines 98–100.

**Warning signs:** No warning shown when a subtask fails to insert (rare, but possible if DB constraint violation occurs).

### Pitfall 4: Modal Stays Open on Submission

**What goes wrong:** User submits, optimistic task appears, but modal doesn't close. User clicks outside to close it manually.

**Why it happens:** Forgot to call `onClose()` after optimistic insert.

**How to avoid:**
- Call `onClose()` in the try block AFTER `resetForm()`.
- If deferring `onClose()` until server confirms, use a callback to close after the server responds.
- For this phase, close immediately (CONTEXT.md decision).

**Current implementation:** Already correct in `new-task-modal.tsx` line 102.

**Warning signs:** Modal still visible after task creation. UX feels broken.

### Pitfall 5: Assignee Validation Skipped

**What goes wrong:** User creates a task with no assignees (unchecks all). Task is invisible to everyone. No error message.

**Why it happens:** Forgot to validate `selectedMemberIds.length > 0` before submission.

**How to avoid:**
- Submit button disabled when `selectedMemberIds.length === 0` (validation on button).
- Form `handleSubmit` early-returns if `selectedMemberIds.length === 0` (defense in depth).
- Server action also assumes memberIds non-empty (does not double-check, relies on client).

**Current implementation:** Already correct in `new-task-modal.tsx` lines 85, 279.

**Warning signs:** Disabled submit button doesn't prevent form submission (should not happen, but indicates loose validation).

### Pitfall 6: Workspace Member Reset Not Triggered

**What goes wrong:** User switches workspace, but modal still shows members from the previous workspace, or shows an empty selection after switching.

**Why it happens:** `handleWorkspaceChange` doesn't update `selectedMemberIds`.

**How to avoid:**
- Call `setSelectedMemberIds(getInitialMembers(id))` in `handleWorkspaceChange` (lines 42–44 in current code).

**Current implementation:** Already correct. Workspace switch resets assignees to creator in new workspace.

**Warning signs:** Member checkboxes don't update when workspace selector changes.

### Pitfall 7: Optimistic Task Lost on Server Revalidation

**What goes wrong:** Optimistic task appears, user sees it, then page revalidates from server. If the server query hasn't picked it up yet, the optimistic task disappears.

**Why it happens:** `revalidatePath("/tasks")` in server action triggers a background refresh. If the refresh completes before the server mutation is fully reflected in the database, the optimistic task (which is local state) is lost when the page refetches.

**How to avoid:**
- Keep optimistic tasks in local state even after `revalidatePath` completes.
- Do NOT refetch the page in the component; let Next.js handle cache revalidation automatically.
- The server mutation + revalidation are sequential: insert task → revalidate → next page load sees the task.
- Local optimistic state should not be cleared by server updates; just replace temporary IDs when the real task ID arrives.

**Current implementation:** Client component maintains local state independently. No conflict.

**Warning signs:** Task appears then disappears after a few seconds.

## Code Examples

Verified patterns from existing codebase:

### Example 1: Server Action with Admin Client and Error Handling

Source: `src/app/tasks/actions.ts` lines 64–153

```typescript
export async function createTaskWithSubtasks({
  title,
  description,
  dueAt,
  workspaceId,
  memberIds,
  subtasks,
}: {
  title: string;
  description?: string;
  dueAt?: string;
  workspaceId: string;
  memberIds: string[];
  subtasks: { title: string; dueAt?: string }[];
}): Promise<{ subtaskErrors: number }> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const uniqueMemberIds = [...new Set(memberIds)]; // Dedup

  // Admin client for recursive RLS bypass
  const { data: parent, error: parentError } = await admin
    .from("tasks")
    .insert({
      title,
      description: description ?? null,
      due_at: dueAt ? `${dueAt}:00Z` : null,
      workspace_id: workspaceId,
    })
    .select()
    .single();

  if (parentError || !parent) throw new Error(parentError?.message ?? "Failed to create task");

  // Insert assignments for each member
  for (const memberId of uniqueMemberIds) {
    const { data: last } = await admin
      .from("task_assignments")
      .select("member_sort_key")
      .eq("member_id", memberId)
      .order("member_sort_key", { ascending: false })
      .limit(1)
      .single();
    const sortKey = last ? (last.member_sort_key as number) + 1000 : 1000;
    await admin.from("task_assignments").insert({
      task_id: parent.id,
      member_id: memberId,
      member_sort_key: sortKey,
    });
  }

  // Insert subtasks (partial failure allowed)
  let subtaskErrors = 0;
  for (const sub of subtasks) {
    const { data: subtask, error: subError } = await admin
      .from("tasks")
      .insert({
        title: sub.title,
        due_at: sub.dueAt ? `${sub.dueAt}T00:00:00Z` : null,
        workspace_id: workspaceId,
        parent_task_id: parent.id,
      })
      .select()
      .single();

    if (subError || !subtask) {
      subtaskErrors++;
      continue; // Allow partial failure
    }

    // Assign subtask to all members
    for (const memberId of uniqueMemberIds) {
      const { data: last } = await admin
        .from("task_assignments")
        .select("member_sort_key")
        .eq("member_id", memberId)
        .order("member_sort_key", { ascending: false })
        .limit(1)
        .single();
      const sortKey = last ? (last.member_sort_key as number) + 1000 : 1000;
      await admin.from("task_assignments").insert({
        task_id: subtask.id,
        member_id: memberId,
        member_sort_key: sortKey,
      });
    }
  }

  revalidatePath("/tasks");
  return { subtaskErrors };
}
```

**Key takeaways:**
- Admin client bypasses RLS (necessary for recursive policy queries).
- Dedup memberIds with `[...new Set(memberIds)]`.
- Due date format: parent uses `${dueAt}:00Z`, subtask uses `${dueAt}T00:00:00Z` (note the T).
- Sort keys: fetch max, add 1000. Per-member independent.
- Subtask errors are counted, not thrown. Parent succeeds even if some subtasks fail.
- `revalidatePath` at the very end (after all mutations).

### Example 2: Bucket Tasks Function for Client-Side Placement

Source: `src/app/tasks/bucket-tasks.ts` lines 24–71

```typescript
export function bucketTasks(tasks: RawTask[], now: Date = new Date()): TaskBuckets {
  const sorted = [...tasks].sort((a, b) => a.member_sort_key - b.member_sort_key);
  const buckets: TaskBuckets = { overdue: [], today: [], upcoming: [], completed: [] };

  const endOfToday = new Date(now);
  endOfToday.setHours(24, 0, 0, 0); // Start of tomorrow

  for (const raw of sorted) {
    const t: BucketedTask = {
      ...raw,
      shared: raw.assignee_count > 1,
      deadlineLabel: null,
      deadlineVariant: null,
    };

    if (raw.completed_at) {
      buckets.completed.push(t);
      continue;
    }

    if (!raw.due_at) {
      buckets.upcoming.push(t);
      continue;
    }

    const due = new Date(raw.due_at);
    const msUntilDue = due.getTime() - now.getTime();

    if (msUntilDue < 0) {
      t.deadlineLabel = "Overdue";
      t.deadlineVariant = "red";
      buckets.overdue.push(t);
    } else if (due < endOfToday) {
      const hrs = Math.ceil(msUntilDue / (60 * 60 * 1000));
      t.deadlineLabel = `Due in ${hrs} hr${hrs !== 1 ? "s" : ""}`;
      t.deadlineVariant = "yellow";
      buckets.today.push(t);
    } else {
      const days = Math.ceil(msUntilDue / (24 * 60 * 60 * 1000));
      t.deadlineLabel = `Due in ${days} day${days !== 1 ? "s" : ""}`;
      t.deadlineVariant = "green";
      buckets.upcoming.push(t);
    }
  }

  return buckets;
}
```

**Key takeaways:**
- Pure function: no side effects, deterministic.
- Takes optional `now` parameter (default `new Date()` for testing).
- Sorts by `member_sort_key` (per-user priority).
- Computes deadline labels and colors inline.
- "Today" = within 24 hours from now. Uses ceiling (Math.ceil) for display ("Due in 1 hr" not "Due in 0.5 hrs").
- "No due date" tasks go to "Upcoming".

**For client-side optimistic placement:**
```typescript
const optimisticTask: RawTask = {
  id: optimisticId,
  title: title.trim(),
  due_at: dueAt || null,
  completed_at: null,
  workspace: workspaces.find(w => w.id === workspaceId)!,
  member_sort_key: 0, // Temp; will be replaced on server confirm
  assignee_count: selectedMemberIds.length,
};

// To find which bucket it lands in:
const { overdue, today, upcoming, completed } = bucketTasks([optimisticTask]);
// It will be in exactly one of these arrays
```

### Example 3: Modal Component with Validation

Source: `src/app/tasks/new-task-modal.tsx` lines 83–107

```typescript
function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  if (!title.trim() || !workspaceId || selectedMemberIds.length === 0) return;
  startTransition(async () => {
    try {
      const { subtaskErrors } = await createTaskWithSubtasks({
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt: dueAt || undefined,
        workspaceId,
        memberIds: selectedMemberIds,
        subtasks: subtaskRows
          .filter((r) => r.title.trim())
          .map((r) => ({ title: r.title.trim(), dueAt: r.dueAt || undefined })),
      });
      if (subtaskErrors > 0) {
        toast(`Task created, but ${subtaskErrors} subtask(s) could not be saved`, "error");
      }
      resetForm();
      onClose();
    } catch {
      toast("Failed to create task", "error");
    }
  });
}
```

**Key takeaways:**
- Validates: title non-empty, workspace selected, at least one assignee.
- Calls server action inside `startTransition` (shows pending state on button).
- Handles subtask partial failure with warning toast.
- Resets form + closes modal on success (no server wait).
- Catches all errors and shows error toast.

### Example 4: Server Action Tests (Pattern to Follow)

Source: `src/app/tasks/actions.test.ts` lines 91–125

```typescript
describe("createTaskWithSubtasks", () => {
  it("inserts parent task + assignments and returns subtaskErrors: 0 when no subtasks", async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: "parent-id" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });

    const sortKeySingle = jest.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const sortKeyLimit = jest.fn().mockReturnValue({ single: sortKeySingle });
    const sortKeyOrder = jest.fn().mockReturnValue({ limit: sortKeyLimit });
    const sortKeyEq = jest.fn().mockReturnValue({ order: sortKeyOrder });
    const sortKeySelect = jest.fn().mockReturnValue({ eq: sortKeyEq });
    const insertAssignment = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })
      .mockReturnValueOnce({ select: sortKeySelect })
      .mockReturnValueOnce({ insert: insertAssignment });

    (createClient as jest.Mock).mockResolvedValue({});
    (createAdminClient as jest.Mock).mockReturnValue({ from: mockFrom });

    const result = await createTaskWithSubtasks({
      title: "Parent task",
      workspaceId: "ws-1",
      memberIds: ["m-1"],
      subtasks: [],
    });

    expect(insertTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Parent task", workspace_id: "ws-1" })
    );
    expect(result).toEqual({ subtaskErrors: 0 });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });
});
```

**Pattern to follow for Phase 2:**
- Mock Supabase clients upfront.
- Chain mock returns to match the actual query structure.
- Test one scenario per spec (e.g., "happy path", "error case", "partial failure").
- Assert on the arguments passed to the mocked functions (e.g., title, workspace_id).
- Assert on the return value or side effects (revalidatePath call).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual sort key calculation on client | Fetch max sort key per member from DB | From start (actions.ts) | Ensures no collisions; avoids racy sort key generation on client |
| Redux for task list state | Local useState in TasksPageClient | From start (tasks-page-client.tsx) | Simpler for this scale; Next.js cache handles server state |
| Separate create/update forms | Unified modal with create-only focus | Phase 1–2 | Clearer UX; Phase 3 adds edit (separate flow or modal mode) |
| User-input sort keys | Admin-generated (last+1000) sort keys | From start | Prevents user manipulation of priority order until Phase 4 (drag-to-reorder) |

**Deprecated/Outdated:**
- PIN-based workspace join: Removed after Phase 1 (public directory instead)
- Inline task RLS checks: Never used; RLS policies on tables + admin client handle security

## Validation Architecture

**Note:** `workflow.nyquist_validation` is `true` in `.planning/config.json`, so test infrastructure validation is REQUIRED.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30.3.0 + React Testing Library 16.3.2 |
| Config file | `jest.config.js` (root) or `package.json` scripts |
| Quick run command | `npm test -- --testPathPattern="(actions\|new-task-modal)" --watch` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TASK-01 | `createTaskWithSubtasks` inserts task with title, description, dueAt, workspaceId, memberIds | unit | `npm test -- src/app/tasks/actions.test.ts -t "createTaskWithSubtasks"` | ✅ existing |
| TASK-01 | Modal renders all fields (title, description, due date, workspace, assignee checkboxes, subtasks) | component | `npm test -- src/app/tasks/new-task-modal.test.tsx -t "renders"` | ✅ existing |
| TASK-01 | Modal submit blocked when no assignee selected | component | `npm test -- src/app/tasks/new-task-modal.test.tsx -t "submit.*disabled"` | ✅ existing |
| TASK-01 | Workspace switch resets assignee selection | component | `npm test -- src/app/tasks/new-task-modal.test.tsx -t "workspace"` | ❌ Wave 0 — needs test |
| TASK-02 | Optimistic task appears in correct bucket (TODAY/UPCOMING/OVERDUE) before server response | component | `npm test -- src/app/tasks/tasks-page-client.test.tsx -t "optimistic"` | ❌ Wave 0 — needs test file |
| TASK-02 | On server error, optimistic task removed + error toast shown | component | `npm test -- src/app/tasks/tasks-page-client.test.tsx -t "error"` | ❌ Wave 0 — needs test file |
| TASK-01 | Subtask partial failure: warning toast shown | component | `npm test -- src/app/tasks/new-task-modal.test.tsx -t "subtask.*error"` | ❌ Wave 0 — needs test |

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern="(actions\|new-task-modal)" --testNamePattern="(createTaskWithSubtasks\|NewTaskModal)" --coverage` (ensures red→green flow for action + modal)
- **Per wave merge:** `npm test` (full suite, all tasks)
- **Phase gate:** All tests green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/app/tasks/tasks-page-client.test.tsx` — Missing; must cover:
  - `handleTaskCreated` inserts optimistic task into local state
  - Optimistic task appears in correct bucket (before server response)
  - On server error, optimistic task removed from state + error toast shown
  - Modal close handler works correctly
- [ ] `src/app/tasks/new-task-modal.test.tsx` — Existing tests; add:
  - Workspace switch resets assignee to creator only (more specific test)
  - Subtask partial failure shows warning toast (not success toast)
- [ ] Test utilities: `src/app/tasks/__mocks__/bucket-tasks.ts` — Optional; can mock or import real function

## Open Questions

1. **Sort key for optimistic tasks — finalize on server response?**
   - What we know: Current code uses sort key 0 (temporary). Server returns real sort key in task_assignments.
   - What's unclear: Should the real sort key be fetched from the server response, or just assumed to be correct?
   - Recommendation: Server action returns `{ subtaskErrors, taskId }` (for real ID replacement). Planner decides if sort key should also be returned. For now, assume 0 is fine (tasks will re-bucket when page loads or server response arrives).

2. **Optimistic task type definition — add to bucket-tasks.ts or modal.tsx?**
   - What we know: `RawTask` type exists in `bucket-tasks.ts`. Optimistic task must match it.
   - What's unclear: Where should the optimistic task constructor live? Modal or parent?
   - Recommendation: Define a helper in `bucket-tasks.ts`: `function makeOptimisticTask(...)` to keep bucket logic centralized.

3. **Error toast vs. warning toast for subtask partial failure?**
   - What we know: CONTEXT.md says "warning toast" for subtask fail. Current code uses `"error"` type.
   - What's unclear: Is `toast(msg, "warning")` the right type argument? Check `components/toaster.tsx`.
   - Recommendation: Verify toast component supports "warning" type. If not, use "error" (both are acceptable user feedback).

## Sources

### Primary (HIGH confidence)

- **Project codebase:** `/src/app/tasks/actions.ts` — Server action `createTaskWithSubtasks` fully implemented and tested
- **Project codebase:** `/src/app/tasks/new-task-modal.tsx` — Modal UI complete with all fields and validation
- **Project codebase:** `/src/app/tasks/bucket-tasks.ts` — Pure bucket logic function, reusable on client
- **Project codebase:** `/src/app/tasks/actions.test.ts` — Comprehensive test patterns for server actions
- **Project codebase:** `/src/app/tasks/new-task-modal.test.tsx` — Component test patterns using React Testing Library
- **Project documentation:** `.planning/phases/02-task-creation/02-CONTEXT.md` — User decisions on optimistic UI, assignee defaults, error handling
- **Project documentation:** `docs/product.md` — Product requirements for task creation (title, description, due date, assignees)
- **Project documentation:** `docs/db.md` — Database schema (tasks, task_assignments, member_sort_key)

### Secondary (MEDIUM confidence — verified against codebase)

- **Next.js App Router patterns:** `useTransition` hook for server action pending states (React 19, Next 16 standard)
- **Supabase SDKs:** `@supabase/supabase-js` 2.98.0 + `@supabase/ssr` 0.9.0 documented in package.json and integration in `lib/supabase/*.ts`
- **Jest + React Testing Library:** Established patterns in existing test files (mocking, fireEvent, waitFor, expect)

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| Server action implementation | HIGH | `createTaskWithSubtasks` fully implemented, tested with 13 test cases covering all fields, error paths, subtask partial failure |
| Modal UI implementation | HIGH | Form complete with all fields (title, description, due date, workspace, assignee checkboxes, subtasks), validation in place, tests cover basic interaction |
| Bucket logic | HIGH | Pure function, well-tested in `bucket-tasks.test.ts`, deterministic, portable to client |
| Optimistic state integration | MEDIUM | Pattern is standard (useTransition + local state), but implementation in `tasks-page-client.tsx` is NEW (not yet done); design is sound, needs careful execution |
| Test requirements | HIGH | Test framework established (Jest, React Testing Library), patterns clear, some test files already exist; Wave 0 gaps identified (tasks-page-client.test.tsx) |

**Research date:** 2026-03-27
**Valid until:** 2026-04-10 (14 days — standard phase cycle stable)

---

*Phase: 02-task-creation*
*Research completed: 2026-03-27*
