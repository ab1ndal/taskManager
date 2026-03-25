# Tasks Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mock task data with real Supabase queries; add complete, delete, and create task interactions; collapsible completed section at bottom of list.

**Architecture:** Server Component page fetches tasks server-side via three sequential Supabase queries; three Server Actions handle mutations and call `revalidatePath("/tasks")` to trigger re-render; URL search params (`workspace`, `view`) drive filtering without client state; deadline bucketing is a pure server-side function.

**Tech Stack:** Next.js 16 Server Components, Server Actions, `revalidatePath` (`next/cache`), Supabase JS (`@supabase/ssr`), React `useTransition` for pending feedback, Tailwind 4, Jest + React Testing Library

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/002_rls_policies.sql` | Create | Enable RLS on all 5 tables with per-table policies |
| `src/app/tasks/bucket-tasks.ts` | Create | Pure fn: `RawTask[]` → `{ overdue, today, upcoming, completed }` |
| `src/app/tasks/bucket-tasks.test.ts` | Create | Unit tests for bucketing logic |
| `src/app/tasks/actions.ts` | Create | Server Actions: `completeTask`, `deleteTask`, `createTask` |
| `src/app/tasks/actions.test.ts` | Create | Unit tests (mocked Supabase + next/cache) |
| `src/app/tasks/completed-section.tsx` | Create | Collapsible completed tasks section (Client Component) |
| `src/app/tasks/completed-section.test.tsx` | Create | Toggle behavior + count label test |
| `src/app/tasks/new-task-modal.tsx` | Create | New task modal: title, due date, workspace, assignees (Client Component) |
| `src/app/tasks/new-task-modal.test.tsx` | Create | Form validation + cancel test |
| `src/app/tasks/page.tsx` | Modify | Real data fetch, URL param filters, dynamic sidebar |
| `src/components/task-card.tsx` | Modify | Add `taskId`, complete button, delete button; convert to Client Component |

---

## Task 0: Clean up uncommitted auth work

**Files:**
- Commit: `src/app/auth/callback/route.ts`
- Delete: `src/proxy.ts` (accidental duplicate of root `proxy.ts`)

- [ ] **Step 1: Commit the token_hash / verifyOtp addition**

```bash
git add src/app/auth/callback/route.ts
git commit -m "feat: support token_hash + verifyOtp in auth callback"
```

- [ ] **Step 2: Delete the duplicate**

```bash
rm src/proxy.ts
```

- [ ] **Step 3: Verify clean state**

```bash
git status
```
Expected: `nothing to commit, working tree clean`

---

## Task 1: RLS policies migration

**Files:**
- Create: `supabase/migrations/002_rls_policies.sql`

**Note on `task_assignments` SELECT policy:** The spec says "SELECT: member_id belongs to current user". However, detecting shared tasks requires knowing the total assignee count. This plan uses a broader policy — "see all assignments for tasks you are assigned to" — so `task_assignments(count)` sub-queries work correctly. This is still safe: users only see assignments on tasks they already have access to.

- [ ] **Step 1: Write the migration**

`supabase/migrations/002_rls_policies.sql`:

```sql
-- Enable RLS on all tables
ALTER TABLE workspaces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_updates      ENABLE ROW LEVEL SECURITY;

-- workspaces: visible if user has a member row
CREATE POLICY "workspaces_select" ON workspaces
FOR SELECT USING (
  id IN (
    SELECT workspace_id FROM workspace_members
    WHERE auth_user_id = auth.uid()
  )
);

-- workspace_members: visible within shared workspaces
CREATE POLICY "workspace_members_select" ON workspace_members
FOR SELECT USING (
  workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE auth_user_id = auth.uid()
  )
);

-- tasks: visible/mutable if user has a task_assignment row
CREATE POLICY "tasks_select" ON tasks
FOR SELECT USING (
  id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);

CREATE POLICY "tasks_update" ON tasks
FOR UPDATE USING (
  id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);

CREATE POLICY "tasks_delete" ON tasks
FOR DELETE USING (
  id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);

-- tasks insert: user must be a workspace member
CREATE POLICY "tasks_insert" ON tasks
FOR INSERT WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE auth_user_id = auth.uid()
  )
);

-- task_assignments: see ALL assignments for tasks you are assigned to
-- (broader than spec — required for assignee_count > 1 shared detection)
CREATE POLICY "task_assignments_select" ON task_assignments
FOR SELECT USING (
  task_id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);

-- task_assignments insert/delete: user must be a member of the task's workspace
CREATE POLICY "task_assignments_insert" ON task_assignments
FOR INSERT WITH CHECK (
  member_id IN (
    SELECT wm2.id
    FROM workspace_members wm2
    JOIN tasks t ON t.workspace_id = wm2.workspace_id
    JOIN workspace_members wm ON wm.workspace_id = wm2.workspace_id
    WHERE wm.auth_user_id = auth.uid()
    AND t.id = task_id
  )
);

CREATE POLICY "task_assignments_delete" ON task_assignments
FOR DELETE USING (
  member_id IN (
    SELECT wm2.id
    FROM workspace_members wm2
    JOIN tasks t ON t.workspace_id = wm2.workspace_id
    JOIN workspace_members wm ON wm.workspace_id = wm2.workspace_id
    WHERE wm.auth_user_id = auth.uid()
    AND t.id = task_id
  )
);

-- task_updates: tied to task visibility
CREATE POLICY "task_updates_select" ON task_updates
FOR SELECT USING (
  task_id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);

CREATE POLICY "task_updates_insert" ON task_updates
FOR INSERT WITH CHECK (
  task_id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);
```

- [ ] **Step 2: Apply the migration**

If using Supabase cloud:
```bash
npx supabase db push
```
If using local dev:
```bash
npx supabase migration up
```
Expected: migration `002_rls_policies` applied with no errors.

- [ ] **Step 3: Verify seed data still accessible**

Log in to Supabase Studio as a seed user and confirm tasks are visible in the `tasks` table.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/002_rls_policies.sql
git commit -m "feat: add RLS policies for all five tables (migration 002)"
```

---

## Task 2: Bucket-tasks utility

Isolate deadline → section bucketing into a pure, testable function. The page calls this after fetching; tests run without any DB or Next.js dependency.

**Files:**
- Create: `src/app/tasks/bucket-tasks.ts`
- Create: `src/app/tasks/bucket-tasks.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/app/tasks/bucket-tasks.test.ts`:

```typescript
import { bucketTasks, type RawTask } from "./bucket-tasks";

const NOW = new Date("2026-01-15T12:00:00Z");

function task(overrides: Partial<RawTask> = {}): RawTask {
  return {
    id: "t1",
    title: "Test",
    due_at: null,
    completed_at: null,
    workspace: { id: "w1", name: "Home", kind: "household" },
    member_sort_key: 1000,
    assignee_count: 1,
    ...overrides,
  };
}

describe("bucketTasks", () => {
  it("routes completed tasks to completed bucket only", () => {
    const { completed, overdue, today, upcoming } = bucketTasks(
      [task({ completed_at: "2026-01-14T10:00:00Z" })],
      NOW
    );
    expect(completed).toHaveLength(1);
    expect(overdue.length + today.length + upcoming.length).toBe(0);
  });

  it("routes past-due tasks to overdue with red variant", () => {
    const { overdue } = bucketTasks([task({ due_at: "2026-01-14T10:00:00Z" })], NOW);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].deadlineVariant).toBe("red");
  });

  it("routes tasks due within 24 h to today with yellow variant", () => {
    const { today } = bucketTasks([task({ due_at: "2026-01-16T10:00:00Z" })], NOW);
    expect(today).toHaveLength(1);
    expect(today[0].deadlineVariant).toBe("yellow");
  });

  it("routes tasks due in 5 days to upcoming with green variant", () => {
    const { upcoming } = bucketTasks([task({ due_at: "2026-01-20T12:00:00Z" })], NOW);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].deadlineVariant).toBe("green");
  });

  it("routes tasks with no deadline to upcoming with null deadlineLabel", () => {
    const { upcoming } = bucketTasks([task()], NOW);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].deadlineLabel).toBeNull();
  });

  it("sets shared=true when assignee_count > 1", () => {
    const { upcoming } = bucketTasks([task({ assignee_count: 2 })], NOW);
    expect(upcoming[0].shared).toBe(true);
  });

  it("preserves member_sort_key order within each bucket", () => {
    const { upcoming } = bucketTasks(
      [task({ id: "b", member_sort_key: 2000 }), task({ id: "a", member_sort_key: 1000 })],
      NOW
    );
    expect(upcoming.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npx jest bucket-tasks --no-coverage
```
Expected: FAIL — `Cannot find module './bucket-tasks'`

- [ ] **Step 3: Implement bucket-tasks.ts**

`src/app/tasks/bucket-tasks.ts`:

```typescript
export type RawTask = {
  id: string;
  title: string;
  due_at: string | null;
  completed_at: string | null;
  workspace: { id: string; name: string; kind: string };
  member_sort_key: number;
  assignee_count: number;
};

export type BucketedTask = RawTask & {
  shared: boolean;
  deadlineLabel: string | null;
  deadlineVariant: "red" | "yellow" | "green" | null;
};

export type TaskBuckets = {
  overdue: BucketedTask[];
  today: BucketedTask[];
  upcoming: BucketedTask[];
  completed: BucketedTask[];
};

export function bucketTasks(tasks: RawTask[], now: Date = new Date()): TaskBuckets {
  const sorted = [...tasks].sort((a, b) => a.member_sort_key - b.member_sort_key);
  const buckets: TaskBuckets = { overdue: [], today: [], upcoming: [], completed: [] };

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

    const msUntilDue = new Date(raw.due_at).getTime() - now.getTime();

    if (msUntilDue < 0) {
      t.deadlineLabel = "Overdue";
      t.deadlineVariant = "red";
      buckets.overdue.push(t);
    } else if (msUntilDue < 24 * 60 * 60 * 1000) {
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

- [ ] **Step 4: Verify tests pass**

```bash
npx jest bucket-tasks --no-coverage
```
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/bucket-tasks.ts src/app/tasks/bucket-tasks.test.ts
git commit -m "feat: add task deadline bucketing utility with tests"
```

---

## Task 3: Server Actions

**Files:**
- Create: `src/app/tasks/actions.ts`
- Create: `src/app/tasks/actions.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/app/tasks/actions.test.ts`:

```typescript
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { completeTask, deleteTask, createTask } from "./actions";

beforeEach(() => jest.clearAllMocks());

describe("completeTask", () => {
  it("updates completed_at and revalidates /tasks", async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    (createClient as jest.Mock).mockResolvedValue({ from: jest.fn().mockReturnValue({ update }) });

    await completeTask("task-1");

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ completed_at: expect.any(String) })
    );
    expect(eq).toHaveBeenCalledWith("id", "task-1");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });
});

describe("deleteTask", () => {
  it("deletes task and revalidates /tasks", async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const del = jest.fn().mockReturnValue({ eq });
    (createClient as jest.Mock).mockResolvedValue({ from: jest.fn().mockReturnValue({ delete: del }) });

    await deleteTask("task-1");

    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", "task-1");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });
});

describe("createTask", () => {
  it("inserts task + assignment and revalidates", async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: "new-id" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });

    // Sort key query: return no existing row (PGRST116 = no rows)
    const sortKeySingle = jest.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const sortKeyLimit = jest.fn().mockReturnValue({ single: sortKeySingle });
    const sortKeyOrder = jest.fn().mockReturnValue({ limit: sortKeyLimit });
    const sortKeyEq = jest.fn().mockReturnValue({ order: sortKeyOrder });
    const sortKeySelect = jest.fn().mockReturnValue({ eq: sortKeyEq });

    const insertAssignment = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })        // tasks
      .mockReturnValueOnce({ select: sortKeySelect })     // task_assignments (max sort key)
      .mockReturnValueOnce({ insert: insertAssignment }); // task_assignments (insert)

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    await createTask({ title: "Buy milk", workspaceId: "ws-1", memberIds: ["m-1"] });

    expect(insertTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Buy milk", workspace_id: "ws-1" })
    );
    expect(insertAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: "new-id", member_id: "m-1", member_sort_key: 1000 })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npx jest actions.test --no-coverage
```
Expected: FAIL — `Cannot find module './actions'`

- [ ] **Step 3: Implement actions.ts**

`src/app/tasks/actions.ts`:

```typescript
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function completeTask(taskId: string) {
  const supabase = await createClient();
  await supabase
    .from("tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", taskId);
  revalidatePath("/tasks");
}

export async function deleteTask(taskId: string) {
  const supabase = await createClient();
  await supabase.from("tasks").delete().eq("id", taskId);
  revalidatePath("/tasks");
}

export async function createTask({
  title,
  dueAt,
  workspaceId,
  memberIds,
}: {
  title: string;
  dueAt?: string;
  workspaceId: string;
  memberIds: string[];
}) {
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({ title, due_at: dueAt ?? null, workspace_id: workspaceId })
    .select()
    .single();

  if (error || !task) throw new Error(error?.message ?? "Failed to create task");

  for (const memberId of memberIds) {
    const { data: last } = await supabase
      .from("task_assignments")
      .select("member_sort_key")
      .eq("member_id", memberId)
      .order("member_sort_key", { ascending: false })
      .limit(1)
      .single();

    const sortKey = last ? (last.member_sort_key as number) + 1000 : 1000;

    await supabase.from("task_assignments").insert({
      task_id: task.id,
      member_id: memberId,
      member_sort_key: sortKey,
    });
  }

  revalidatePath("/tasks");
}
```

- [ ] **Step 4: Verify tests pass**

```bash
npx jest actions.test --no-coverage
```
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/actions.ts src/app/tasks/actions.test.ts
git commit -m "feat: add completeTask, deleteTask, createTask server actions with tests"
```

---

## Task 4: Update TaskCard with complete and delete buttons

**Files:**
- Modify: `src/components/task-card.tsx`

TaskCard becomes a Client Component so it can call Server Actions with `useTransition` for pending opacity feedback. No new test file — action behavior is covered by the actions tests; visual details are best verified manually.

- [ ] **Step 1: Replace the full contents of task-card.tsx**

`src/components/task-card.tsx`:

```typescript
"use client";

import { useTransition } from "react";
import { completeTask, deleteTask } from "@/app/tasks/actions";

export type DeadlineVariant = "red" | "yellow" | "green";

const deadlineStyles: Record<DeadlineVariant, string> = {
  red: "bg-red-50 text-[var(--color-deadline-red)]",
  yellow: "bg-amber-50 text-[var(--color-deadline-yellow)]",
  green: "bg-emerald-50 text-[var(--color-deadline-green)]",
};

export function DeadlineBadge({ variant, label }: { variant: DeadlineVariant; label: string }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${deadlineStyles[variant]}`}>
      {label}
    </span>
  );
}

export function SharedBadge() {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]">
      Shared
    </span>
  );
}

export function TaskCard({
  taskId,
  title,
  deadline,
  deadlineVariant,
  workspace,
  shared,
  completed,
}: {
  taskId: string;
  title: string;
  deadline?: string | null;
  deadlineVariant?: DeadlineVariant | null;
  workspace: string;
  shared?: boolean;
  completed?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div
      className={`bg-[var(--color-surface)] rounded-[11px] border border-[var(--color-border)] px-4 py-3 flex items-center gap-3 transition-opacity ${pending ? "opacity-40" : ""}`}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* Complete / checkmark button */}
      <button
        onClick={() => {
          if (!completed) startTransition(() => completeTask(taskId));
        }}
        aria-label={completed ? "Completed" : "Mark complete"}
        disabled={completed}
        className="flex-shrink-0 text-[var(--color-border)] hover:text-[var(--color-accent)] disabled:cursor-default transition-colors"
      >
        {completed ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.8" className="text-[var(--color-text-muted)]" />
            <path d="M5.5 9.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-muted)]" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium truncate ${
            completed
              ? "line-through text-[var(--color-text-muted)]"
              : "text-[var(--color-text-primary)]"
          }`}
        >
          {title}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {deadline && deadlineVariant && (
            <DeadlineBadge variant={deadlineVariant} label={deadline} />
          )}
          {shared && <SharedBadge />}
          <span className="text-[11px] text-[var(--color-text-muted)]">{workspace}</span>
        </div>
      </div>

      {/* Delete button — active tasks only */}
      {!completed && (
        <button
          onClick={() => {
            if (!window.confirm(`Delete "${title}"?`)) return;
            startTransition(() => deleteTask(taskId));
          }}
          aria-label="Delete task"
          className="flex-shrink-0 text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M5.5 6v4M8.5 6v4M3 3.5l.5 8a.5.5 0 00.5.5h6a.5.5 0 00.5-.5l.5-8" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="var(--color-accent-subtle)" />
        <path
          d="M20 38 Q26 26 32 30 Q38 34 44 22"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="20" cy="38" r="2.5" fill="var(--color-accent)" opacity="0.4" />
        <circle cx="32" cy="30" r="2.5" fill="var(--color-accent)" opacity="0.65" />
        <circle cx="44" cy="22" r="2.5" fill="var(--color-accent)" />
        <path d="M24 46h16" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round" />
        <path d="M27 51h10" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <p className="text-sm text-[var(--color-text-muted)]">
        No tasks yet.
        <br />
        Add one to get started.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Run all tests to check for regressions**

```bash
npx jest --no-coverage
```
Expected: all previously passing tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/task-card.tsx
git commit -m "feat: add complete and delete buttons to TaskCard"
```

---

## Task 5: Completed section component

**Files:**
- Create: `src/app/tasks/completed-section.tsx`
- Create: `src/app/tasks/completed-section.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/app/tasks/completed-section.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { CompletedSection } from "./completed-section";

// TaskCard calls server actions — stub to avoid import issues in jsdom
jest.mock("@/components/task-card", () => ({
  TaskCard: ({ title }: { title: string }) => <div>{title}</div>,
}));

const tasks = [
  {
    taskId: "1",
    title: "Done A",
    deadline: null,
    deadlineVariant: null,
    workspace: "Home",
    shared: false,
    completed: true as const,
  },
  {
    taskId: "2",
    title: "Done B",
    deadline: null,
    deadlineVariant: null,
    workspace: "Work",
    shared: false,
    completed: true as const,
  },
];

describe("CompletedSection", () => {
  it("is collapsed by default", () => {
    render(<CompletedSection tasks={tasks} />);
    expect(screen.queryByText("Done A")).not.toBeInTheDocument();
  });

  it("shows count in toggle label", () => {
    render(<CompletedSection tasks={tasks} />);
    expect(screen.getByRole("button")).toHaveTextContent("2 completed");
  });

  it("reveals tasks after clicking toggle", () => {
    render(<CompletedSection tasks={tasks} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Done A")).toBeInTheDocument();
    expect(screen.getByText("Done B")).toBeInTheDocument();
  });

  it("collapses again on second click", () => {
    render(<CompletedSection tasks={tasks} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByText("Done A")).not.toBeInTheDocument();
  });

  it("renders nothing when tasks list is empty", () => {
    const { container } = render(<CompletedSection tasks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npx jest completed-section --no-coverage
```
Expected: FAIL — `Cannot find module './completed-section'`

- [ ] **Step 3: Implement completed-section.tsx**

`src/app/tasks/completed-section.tsx`:

```typescript
"use client";

import { useState } from "react";
import { TaskCard } from "@/components/task-card";
import type { DeadlineVariant } from "@/components/task-card";

type CompletedTask = {
  taskId: string;
  title: string;
  deadline: string | null;
  deadlineVariant: DeadlineVariant | null;
  workspace: string;
  shared: boolean;
  completed: true;
};

export function CompletedSection({ tasks }: { tasks: CompletedTask[] }) {
  const [open, setOpen] = useState(false);

  if (tasks.length === 0) return null;

  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-2 hover:text-[var(--color-text-secondary)] transition-colors"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={`transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          <path d="M3 2l4 3-4 3V2z" />
        </svg>
        {tasks.length} completed
      </button>

      {open && (
        <div className="flex flex-col gap-1.5">
          {tasks.map((t) => (
            <TaskCard key={t.taskId} {...t} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify tests pass**

```bash
npx jest completed-section --no-coverage
```
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/completed-section.tsx src/app/tasks/completed-section.test.tsx
git commit -m "feat: add collapsible completed tasks section with tests"
```

---

## Task 6: New task modal

**Files:**
- Create: `src/app/tasks/new-task-modal.tsx`
- Create: `src/app/tasks/new-task-modal.test.tsx`

- [ ] **Step 1: Write failing tests**

`src/app/tasks/new-task-modal.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { NewTaskModal } from "./new-task-modal";

jest.mock("./actions", () => ({
  createTask: jest.fn().mockResolvedValue(undefined),
}));

const workspaces = [
  {
    id: "ws-1",
    name: "Home",
    kind: "household",
    members: [{ id: "m-1", display_name: "Alice" }],
  },
];

describe("NewTaskModal", () => {
  it("submit button is disabled when title is empty", () => {
    render(<NewTaskModal workspaces={workspaces} currentMemberIds={["m-1"]} />);
    fireEvent.click(screen.getByRole("button", { name: /new task/i }));
    expect(screen.getByRole("button", { name: /add task/i })).toBeDisabled();
  });

  it("enables submit once title is entered", () => {
    render(<NewTaskModal workspaces={workspaces} currentMemberIds={["m-1"]} />);
    fireEvent.click(screen.getByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByPlaceholderText(/task title/i), {
      target: { value: "Buy milk" },
    });
    expect(screen.getByRole("button", { name: /add task/i })).not.toBeDisabled();
  });

  it("closes the modal when cancel is clicked", () => {
    render(<NewTaskModal workspaces={workspaces} currentMemberIds={["m-1"]} />);
    fireEvent.click(screen.getByRole("button", { name: /new task/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByPlaceholderText(/task title/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npx jest new-task-modal --no-coverage
```
Expected: FAIL — `Cannot find module './new-task-modal'`

- [ ] **Step 3: Implement new-task-modal.tsx**

`src/app/tasks/new-task-modal.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import { createTask } from "./actions";

type WorkspaceMember = { id: string; display_name: string };
type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };

export function NewTaskModal({
  workspaces,
  currentMemberIds,
}: {
  workspaces: Workspace[];
  currentMemberIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(currentMemberIds);
  const [pending, startTransition] = useTransition();

  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  function handleWorkspaceChange(id: string) {
    setWorkspaceId(id);
    const ws = workspaces.find((w) => w.id === id);
    const myMembersInWs =
      ws?.members.filter((m) => currentMemberIds.includes(m.id)).map((m) => m.id) ?? [];
    setSelectedMemberIds(myMembersInWs);
  }

  function toggleMember(id: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || selectedMemberIds.length === 0) return;
    startTransition(async () => {
      await createTask({
        title: title.trim(),
        dueAt: dueAt || undefined,
        workspaceId,
        memberIds: selectedMemberIds,
      });
      setOpen(false);
      setTitle("");
      setDueAt("");
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mb-4 w-full flex items-center justify-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium rounded-[8px] py-[9px] transition-colors"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 1v10M1 6h10" />
        </svg>
        New task
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[var(--color-surface)] rounded-[14px] border border-[var(--color-border)] p-6 w-full max-w-md mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-4">New task</h3>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <input
                type="text"
                placeholder="Task title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                autoFocus
              />

              <div>
                <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                  Due date (optional)
                </label>
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                  Workspace
                </label>
                <select
                  value={workspaceId}
                  onChange={(e) => handleWorkspaceChange(e.target.value)}
                  className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                  Assign to
                </label>
                <div className="flex flex-col gap-1.5">
                  {currentWorkspace?.members.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.includes(m.id)}
                        onChange={() => toggleMember(m.id)}
                        className="rounded"
                      />
                      {m.display_name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 text-sm rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || selectedMemberIds.length === 0 || pending}
                  className="px-4 py-2 text-sm font-medium rounded-[8px] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {pending ? "Adding…" : "Add task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Verify tests pass**

```bash
npx jest new-task-modal --no-coverage
```
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/new-task-modal.tsx src/app/tasks/new-task-modal.test.tsx
git commit -m "feat: add new task modal with workspace and assignee selection"
```

---

## Task 7: Wire page.tsx to real data

**Files:**
- Modify: `src/app/tasks/page.tsx`

This replaces all mock data with three sequential Supabase queries. The sidebar becomes dynamic (real workspaces, Link navigation). The `SidebarItem` div component is replaced with a `SidebarLink` using `next/link`.

- [ ] **Step 1: Replace the full contents of page.tsx**

`src/app/tasks/page.tsx`:

```typescript
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TaskCard, EmptyState } from "@/components/task-card";
import { bucketTasks, type RawTask } from "./bucket-tasks";
import { CompletedSection } from "./completed-section";
import { NewTaskModal } from "./new-task-modal";

type SearchParams = Promise<{ workspace?: string; view?: string }>;

function SidebarLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-2 py-[7px] rounded-[8px] text-sm font-medium ${
        active
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]/50"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { workspace: workspaceFilter, view: viewFilter } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Query 1: all workspace members visible to current user (RLS: same workspace only)
  const { data: allMembers } = await supabase
    .from("workspace_members")
    .select("id, workspace_id, auth_user_id, display_name, workspaces(id, name, kind)");

  const myMembers = (allMembers ?? []).filter((m) => m.auth_user_id === user?.id);
  const myMemberIds = myMembers.map((m) => m.id);

  // Derive workspace map for sidebar + modal
  const workspaceMap: Record<
    string,
    { id: string; name: string; kind: string; members: { id: string; display_name: string }[] }
  > = {};
  (allMembers ?? []).forEach((m) => {
    const ws = m.workspaces as { id: string; name: string; kind: string } | null;
    if (!ws) return;
    if (!workspaceMap[ws.id]) workspaceMap[ws.id] = { ...ws, members: [] };
    workspaceMap[ws.id].members.push({ id: m.id, display_name: m.display_name });
  });
  const myWorkspaces = Object.values(workspaceMap).filter((ws) =>
    myMembers.some((m) => m.workspace_id === ws.id)
  );

  // Query 2: task assignments for current user (sort key + task IDs)
  const { data: myAssignments } = myMemberIds.length
    ? await supabase
        .from("task_assignments")
        .select("task_id, member_sort_key")
        .in("member_id", myMemberIds)
        .order("member_sort_key", { ascending: true })
    : { data: [] };

  const myTaskIds = (myAssignments ?? []).map((a) => a.task_id);
  const sortKeyByTaskId: Record<string, number> = {};
  (myAssignments ?? []).forEach((a) => {
    sortKeyByTaskId[a.task_id] = a.member_sort_key as number;
  });

  // Query 3a: full task data (RLS-filtered)
  const { data: tasksData } = myTaskIds.length
    ? await supabase
        .from("tasks")
        .select("id, title, due_at, completed_at, parent_task_id, workspace_id")
        .in("id", myTaskIds)
        .is("parent_task_id", null)
    : { data: [] };

  // Query 3b: all assignments for these tasks (for assignee count / shared detection)
  const { data: allAssignments } = myTaskIds.length
    ? await supabase
        .from("task_assignments")
        .select("task_id")
        .in("task_id", myTaskIds)
    : { data: [] };

  const assigneeCounts: Record<string, number> = {};
  (allAssignments ?? []).forEach((a) => {
    assigneeCounts[a.task_id] = (assigneeCounts[a.task_id] ?? 0) + 1;
  });

  // Shape into RawTask[]
  const rawTasks: RawTask[] = (tasksData ?? []).map((t) => {
    const ws = workspaceMap[t.workspace_id as string] ?? {
      id: t.workspace_id as string,
      name: "Unknown",
      kind: "work",
    };
    return {
      id: t.id,
      title: t.title,
      due_at: t.due_at,
      completed_at: t.completed_at,
      workspace: { id: ws.id, name: ws.name, kind: ws.kind },
      member_sort_key: sortKeyByTaskId[t.id] ?? 0,
      assignee_count: assigneeCounts[t.id] ?? 1,
    };
  });

  // Apply URL filters
  const filtered = rawTasks.filter((t) => {
    if (workspaceFilter && t.workspace.kind !== workspaceFilter) return false;
    if (viewFilter === "shared" && t.assignee_count <= 1) return false;
    return true;
  });

  const { overdue, today, upcoming, completed } = bucketTasks(filtered);
  const hasAnyTasks = overdue.length + today.length + upcoming.length + completed.length > 0;
  const name = user?.user_metadata?.name || user?.email || "there";

  return (
    <div className="flex min-h-[calc(100vh-52px)] -m-6">
      {/* Sidebar */}
      <aside className="hidden md:flex w-[200px] flex-col bg-[var(--color-surface)] border-r border-[var(--color-border)] p-3 flex-shrink-0">
        <NewTaskModal workspaces={myWorkspaces} currentMemberIds={myMemberIds} />

        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] px-2 mb-1">
          Views
        </p>
        <SidebarLink
          href="/tasks"
          active={!workspaceFilter && !viewFilter}
          icon={
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M2 4h11M2 7.5h7M2 11h5" />
            </svg>
          }
          label="My tasks"
        />
        <SidebarLink
          href="/tasks?view=shared"
          active={viewFilter === "shared"}
          icon={
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="5.5" cy="5.5" r="3.5" />
              <circle cx="9.5" cy="9.5" r="3.5" />
            </svg>
          }
          label="Shared"
        />

        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] px-2 mb-1 mt-4">
          Spaces
        </p>
        {myWorkspaces.map((ws) => (
          <SidebarLink
            key={ws.id}
            href={`/tasks?workspace=${ws.kind}`}
            active={workspaceFilter === ws.kind}
            icon={
              ws.kind === "household" ? (
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M1.5 6L7.5 1.5L13.5 6V13.5a.75.75 0 01-.75.75H2.25A.75.75 0 011.5 13.5V6z" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <rect x="1.5" y="4" width="12" height="9" rx="1.25" />
                  <path d="M4.5 4V3a.75.75 0 01.75-.75h4.5A.75.75 0 0110.5 3v1" />
                </svg>
              )
            }
            label={ws.name}
          />
        ))}
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">
        <h2 className="text-xl font-semibold tracking-tight mb-1">Hello, {name}</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-6">Here are your tasks.</p>

        {!hasAnyTasks ? (
          <EmptyState />
        ) : (
          <>
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
                  <div className="flex flex-col gap-1.5">
                    {sectionTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        taskId={task.id}
                        title={task.title}
                        deadline={task.deadlineLabel}
                        deadlineVariant={task.deadlineVariant}
                        workspace={task.workspace.name}
                        shared={task.shared}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            <CompletedSection
              tasks={completed.map((t) => ({
                taskId: t.id,
                title: t.title,
                deadline: t.deadlineLabel,
                deadlineVariant: t.deadlineVariant,
                workspace: t.workspace.name,
                shared: t.shared,
                completed: true as const,
              }))}
            />
          </>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Run all tests**

```bash
npx jest --no-coverage
```
Expected: all tests PASS.

- [ ] **Step 3: Start dev server and smoke-test**

```bash
npm run dev
```

Verify manually:
- Log in → tasks page loads without errors
- Tasks from seed data are visible
- Clicking circle on a task marks it complete and moves it to the collapsible section
- Clicking the delete icon (with confirm) removes the task
- "New task" button opens the modal; filling in title + submit adds a task
- Sidebar "Household" / "Work" links filter correctly
- "Shared" link filters to multi-assignee tasks

- [ ] **Step 4: Commit**

```bash
git add src/app/tasks/page.tsx
git commit -m "feat: wire tasks page to real Supabase data with filters and dynamic sidebar"
```

---

## Final verification

- [ ] **Run full test suite**

```bash
npx jest --no-coverage
```
Expected: all tests PASS, zero failures.

- [ ] **Build check**

```bash
npm run build
```
Expected: build completes with no TypeScript errors.
