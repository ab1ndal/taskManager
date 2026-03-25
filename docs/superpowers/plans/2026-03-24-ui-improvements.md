# UI Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top tab bar for small screens, fix the new task modal's scroll/visibility, and add description + inline subtask creation.

**Architecture:** Lift modal-open state into a new `TasksPageClient` client wrapper so both the sidebar and the new tab strip can trigger the same modal. The modal becomes a pure overlay accepting `open`/`onClose` props. A new `createTaskWithSubtasks` server action handles parent + subtask inserts atomically with a single revalidation.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind v4, Supabase, Jest + React Testing Library

---

## File Map

| File | Status | Responsibility |
|------|--------|---------------|
| `src/app/tasks/actions.ts` | Modify | Add `createTaskWithSubtasks` server action |
| `src/app/tasks/actions.test.ts` | Modify | Add tests for `createTaskWithSubtasks` |
| `src/app/tasks/new-task-modal.tsx` | Modify | Accept `open`/`onClose` props; add description + subtasks; call `createTaskWithSubtasks` |
| `src/app/tasks/new-task-modal.test.tsx` | Modify | Update tests to new prop interface; add description + subtask tests |
| `src/app/tasks/tasks-page-client.tsx` | Create | Client wrapper owning `isOpen` state; renders sidebar, tab strip, modal |
| `src/app/tasks/tab-pill.tsx` | Create | Client component — single pill with active state via `useSearchParams` |
| `src/app/tasks/page.tsx` | Modify | Remove `NewTaskModal` import; render `TasksPageClient` with data props |

---

## Task 1: `createTaskWithSubtasks` server action

**Files:**
- Modify: `src/app/tasks/actions.ts`
- Modify: `src/app/tasks/actions.test.ts`

- [ ] **Step 1: Write the failing test for `createTaskWithSubtasks`**

Add to `src/app/tasks/actions.test.ts`:

```ts
import { createTaskWithSubtasks } from "./actions";

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

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

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
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("inserts subtasks with parent_task_id and converts bare date to UTC midnight", async () => {
    // parent insert
    const single = jest.fn().mockResolvedValue({ data: { id: "parent-id" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });

    // sort key for parent member
    const skSingle1 = jest.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const skLimit1 = jest.fn().mockReturnValue({ single: skSingle1 });
    const skOrder1 = jest.fn().mockReturnValue({ limit: skLimit1 });
    const skEq1 = jest.fn().mockReturnValue({ order: skOrder1 });
    const skSelect1 = jest.fn().mockReturnValue({ eq: skEq1 });
    const insertAsgn1 = jest.fn().mockResolvedValue({ error: null });

    // subtask insert
    const subSingle = jest.fn().mockResolvedValue({ data: { id: "sub-id" }, error: null });
    const subSelect = jest.fn().mockReturnValue({ single: subSingle });
    const insertSubtask = jest.fn().mockReturnValue({ select: subSelect });

    // sort key for subtask member
    const skSingle2 = jest.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const skLimit2 = jest.fn().mockReturnValue({ single: skSingle2 });
    const skOrder2 = jest.fn().mockReturnValue({ limit: skLimit2 });
    const skEq2 = jest.fn().mockReturnValue({ order: skOrder2 });
    const skSelect2 = jest.fn().mockReturnValue({ eq: skEq2 });
    const insertAsgn2 = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })    // parent task
      .mockReturnValueOnce({ select: skSelect1 })     // sort key parent
      .mockReturnValueOnce({ insert: insertAsgn1 })   // assignment parent
      .mockReturnValueOnce({ insert: insertSubtask }) // subtask
      .mockReturnValueOnce({ select: skSelect2 })     // sort key subtask
      .mockReturnValueOnce({ insert: insertAsgn2 });  // assignment subtask

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    const result = await createTaskWithSubtasks({
      title: "Parent",
      workspaceId: "ws-1",
      memberIds: ["m-1"],
      subtasks: [{ title: "Subtask A", dueAt: "2026-03-25" }],
    });

    expect(insertSubtask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Subtask A",
        parent_task_id: "parent-id",
        due_at: "2026-03-25T00:00:00Z",
      })
    );
    expect(result).toEqual({ subtaskErrors: 0 });
  });

  it("returns subtaskErrors: 1 when a subtask insert fails", async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: "parent-id" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });

    const skSingle = jest.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const skLimit = jest.fn().mockReturnValue({ single: skSingle });
    const skOrder = jest.fn().mockReturnValue({ limit: skLimit });
    const skEq = jest.fn().mockReturnValue({ order: skOrder });
    const skSelect = jest.fn().mockReturnValue({ eq: skEq });
    const insertAsgn = jest.fn().mockResolvedValue({ error: null });

    // subtask insert fails
    const subSingle = jest.fn().mockResolvedValue({ data: null, error: { message: "DB error" } });
    const subSelect = jest.fn().mockReturnValue({ single: subSingle });
    const insertSubtask = jest.fn().mockReturnValue({ select: subSelect });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })
      .mockReturnValueOnce({ select: skSelect })
      .mockReturnValueOnce({ insert: insertAsgn })
      .mockReturnValueOnce({ insert: insertSubtask });

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    const result = await createTaskWithSubtasks({
      title: "Parent",
      workspaceId: "ws-1",
      memberIds: ["m-1"],
      subtasks: [{ title: "Bad subtask" }],
    });

    expect(result).toEqual({ subtaskErrors: 1 });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest src/app/tasks/actions.test.ts --no-coverage
```

Expected: FAIL — `createTaskWithSubtasks is not a function`

- [ ] **Step 3: Implement `createTaskWithSubtasks` in `src/app/tasks/actions.ts`**

Append after the existing `createTask` function:

```ts
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

  // Insert parent task
  const { data: parent, error: parentError } = await supabase
    .from("tasks")
    .insert({
      title,
      description: description ?? null,
      due_at: dueAt ?? null,
      workspace_id: workspaceId,
    })
    .select()
    .single();

  if (parentError || !parent) throw new Error(parentError?.message ?? "Failed to create task");

  // Assign parent task to each member
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
      task_id: parent.id,
      member_id: memberId,
      member_sort_key: sortKey,
    });
  }

  // Insert subtasks
  let subtaskErrors = 0;
  for (const sub of subtasks) {
    const { data: subtask, error: subError } = await supabase
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
      continue;
    }

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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest src/app/tasks/actions.test.ts --no-coverage
```

Expected: All tests PASS (including existing `createTask`, `completeTask`, `deleteTask` tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/actions.ts src/app/tasks/actions.test.ts
git commit -m "feat: add createTaskWithSubtasks server action"
```

---

## Task 2: Refactor `NewTaskModal` — props interface + description + subtasks

**Files:**
- Modify: `src/app/tasks/new-task-modal.tsx`
- Modify: `src/app/tasks/new-task-modal.test.tsx`

The modal currently renders its own trigger button and owns `open` state. We extract the trigger out, add `open: boolean` and `onClose: () => void` props, add description + subtask rows, and wire to `createTaskWithSubtasks`.

- [ ] **Step 1: Update the tests to match the new interface**

Replace `src/app/tasks/new-task-modal.test.tsx` entirely:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { NewTaskModal } from "./new-task-modal";

jest.mock("./actions", () => ({
  createTask: jest.fn().mockResolvedValue(undefined),
  createTaskWithSubtasks: jest.fn().mockResolvedValue({ subtaskErrors: 0 }),
}));

// useSearchParams is called by TabPill (not modal), but jest needs router mock
jest.mock("next/navigation", () => ({ useSearchParams: jest.fn(() => new URLSearchParams()) }));

const workspaces = [
  {
    id: "ws-1",
    name: "Home",
    kind: "household",
    members: [{ id: "m-1", display_name: "Alice" }],
  },
];

function renderModal(open = true) {
  const onClose = jest.fn();
  render(
    <NewTaskModal
      open={open}
      onClose={onClose}
      workspaces={workspaces}
      currentMemberIds={["m-1"]}
    />
  );
  return { onClose };
}

describe("NewTaskModal", () => {
  it("renders nothing when open is false", () => {
    renderModal(false);
    expect(screen.queryByPlaceholderText(/task title/i)).not.toBeInTheDocument();
  });

  it("renders modal when open is true", () => {
    renderModal(true);
    expect(screen.getByPlaceholderText(/task title/i)).toBeInTheDocument();
  });

  it("submit button is disabled when title is empty", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /add task/i })).toBeDisabled();
  });

  it("enables submit once title is entered", () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/task title/i), {
      target: { value: "Buy milk" },
    });
    expect(screen.getByRole("button", { name: /add task/i })).not.toBeDisabled();
  });

  it("calls onClose when cancel is clicked", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders description textarea", () => {
    renderModal();
    expect(screen.getByPlaceholderText(/add details/i)).toBeInTheDocument();
  });

  it("renders '+ Add subtask' link", () => {
    renderModal();
    expect(screen.getByText(/add subtask/i)).toBeInTheDocument();
  });

  it("clicking '+ Add subtask' adds a subtask row", () => {
    renderModal();
    fireEvent.click(screen.getByText(/add subtask/i));
    expect(screen.getByPlaceholderText(/subtask title/i)).toBeInTheDocument();
  });

  it("clicking ✕ on a subtask row removes it", () => {
    renderModal();
    fireEvent.click(screen.getByText(/add subtask/i));
    expect(screen.getByPlaceholderText(/subtask title/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove subtask/i }));
    expect(screen.queryByPlaceholderText(/subtask title/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest src/app/tasks/new-task-modal.test.tsx --no-coverage
```

Expected: FAIL — modal still renders its own button, `open` prop not supported

- [ ] **Step 3: Rewrite `src/app/tasks/new-task-modal.tsx`**

```tsx
"use client";

import { useState, useTransition, useRef } from "react";
import { createTaskWithSubtasks } from "./actions";
import { toast } from "@/components/toaster";

type WorkspaceMember = { id: string; display_name: string };
type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };
type SubtaskRow = { title: string; dueAt: string };

export function NewTaskModal({
  open,
  onClose,
  workspaces,
  currentMemberIds,
}: {
  open: boolean;
  onClose: () => void;
  workspaces: Workspace[];
  currentMemberIds: string[];
}) {
  const firstWorkspace = workspaces[0];
  const getInitialMembers = (wsId: string) =>
    workspaces.find((w) => w.id === wsId)?.members
      .filter((m) => currentMemberIds.includes(m.id))
      .map((m) => m.id) ?? [];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [workspaceId, setWorkspaceId] = useState(firstWorkspace?.id ?? "");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(
    getInitialMembers(firstWorkspace?.id ?? "")
  );
  const [subtaskRows, setSubtaskRows] = useState<SubtaskRow[]>([]);
  const [pending, startTransition] = useTransition();
  const lastSubtaskRef = useRef<HTMLInputElement>(null);

  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  function handleWorkspaceChange(id: string) {
    setWorkspaceId(id);
    setSelectedMemberIds(getInitialMembers(id));
  }

  function toggleMember(id: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function addSubtaskRow() {
    setSubtaskRows((prev) => [...prev, { title: "", dueAt: "" }]);
    setTimeout(() => lastSubtaskRef.current?.focus(), 0);
  }

  function updateSubtask(index: number, field: keyof SubtaskRow, value: string) {
    setSubtaskRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function removeSubtask(index: number) {
    setSubtaskRows((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubtaskKeyDown(e: React.KeyboardEvent, index: number, rowTitle: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (rowTitle.trim()) addSubtaskRow();
    }
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setDueAt("");
    setWorkspaceId(firstWorkspace?.id ?? "");
    setSelectedMemberIds(getInitialMembers(firstWorkspace?.id ?? ""));
    setSubtaskRows([]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || selectedMemberIds.length === 0) return;
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
          toast(`Task created, but ${subtaskErrors} subtask(s) could not be saved`, "warning");
        }
        resetForm();
        onClose();
      } catch {
        toast("Failed to create task", "error");
      }
    });
  }

  if (!open) return null;

  const disabled = pending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-surface)] rounded-[14px] border border-[var(--color-border)] p-6 w-full max-w-md mx-4 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-4">New task</h3>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={disabled}
            className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
            autoFocus
          />

          <textarea
            placeholder="Add details…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
            rows={3}
            className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] resize-none disabled:opacity-50"
          />

          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">
              Due date (optional)
            </label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              disabled={disabled}
              className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">
              Workspace
            </label>
            <select
              value={workspaceId}
              onChange={(e) => handleWorkspaceChange(e.target.value)}
              disabled={disabled}
              className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
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
                    disabled={disabled}
                    className="rounded"
                  />
                  {m.display_name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-2">
              Subtasks
            </label>
            <div className="flex flex-col gap-1">
              {subtaskRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--color-text-muted)] shrink-0" aria-hidden="true">
                    <circle cx="5" cy="5" r="4" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Subtask title"
                    value={row.title}
                    onChange={(e) => updateSubtask(i, "title", e.target.value)}
                    onKeyDown={(e) => handleSubtaskKeyDown(e, i, row.title)}
                    disabled={disabled}
                    ref={i === subtaskRows.length - 1 ? lastSubtaskRef : undefined}
                    className="flex-1 border border-[var(--color-border)] rounded-[8px] px-2 py-1 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
                  />
                  <input
                    type="date"
                    value={row.dueAt}
                    onChange={(e) => updateSubtask(i, "dueAt", e.target.value)}
                    disabled={disabled}
                    className="border border-[var(--color-border)] rounded-[8px] px-2 py-1 text-xs bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => removeSubtask(i)}
                    disabled={disabled}
                    aria-label="Remove subtask"
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-lg leading-none disabled:opacity-50"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addSubtaskRow}
              disabled={disabled}
              className="mt-1 text-sm text-[var(--color-accent)] hover:underline disabled:opacity-50"
            >
              + Add subtask
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={disabled}
              className="px-4 py-2 text-sm rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)] transition-colors disabled:opacity-50"
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
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest src/app/tasks/new-task-modal.test.tsx --no-coverage
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/new-task-modal.tsx src/app/tasks/new-task-modal.test.tsx
git commit -m "feat: refactor NewTaskModal to accept open/onClose props, add description and subtask fields"
```

---

## Task 3: Create `TabPill` client component

**Files:**
- Create: `src/app/tasks/tab-pill.tsx`

A single pill that checks `useSearchParams()` to determine if it's active. Used only in the tab strip.

- [ ] **Step 1: Create `src/app/tasks/tab-pill.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export function TabPill({
  href,
  label,
  matchKey,
  matchValue,
}: {
  href: string;
  label: string;
  /** The search param key to check for active state, e.g. "workspace" or "view" */
  matchKey?: string;
  /** The expected value for active state. If undefined, active when no params match. */
  matchValue?: string;
}) {
  const searchParams = useSearchParams();
  const active = matchKey
    ? searchParams.get(matchKey) === (matchValue ?? null)
    : !searchParams.get("workspace") && !searchParams.get("view");

  return (
    <Link
      href={href}
      className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]/50"
      }`}
    >
      {label}
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/tasks/tab-pill.tsx
git commit -m "feat: add TabPill client component for tab strip navigation"
```

---

## Task 4: Create `TasksPageClient` — lift modal state, sidebar, and tab strip

**Files:**
- Create: `src/app/tasks/tasks-page-client.tsx`

This client wrapper owns `isOpen` state and renders the sidebar (md+), the tab strip (small screens), and the shared modal overlay. It receives all data + filter props from the server component.

- [ ] **Step 1: Create `src/app/tasks/tasks-page-client.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { NewTaskModal } from "./new-task-modal";
import { TabPill } from "./tab-pill";

type WorkspaceMember = { id: string; display_name: string };
type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };

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

export function TasksPageClient({
  workspaces,
  currentMemberIds,
  workspaceFilter,
  viewFilter,
  children,
}: {
  workspaces: Workspace[];
  currentMemberIds: string[];
  workspaceFilter?: string;
  viewFilter?: string;
  children: React.ReactNode;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      {/* Tab strip — small screens only */}
      <div className="flex md:hidden items-center gap-2 overflow-x-auto px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <button
          onClick={() => setModalOpen(true)}
          className="shrink-0 whitespace-nowrap flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 1v10M1 6h10" />
          </svg>
          New task
        </button>
        <TabPill href="/tasks" label="My tasks" />
        <TabPill href="/tasks?view=shared" label="Shared" matchKey="view" matchValue="shared" />
        {workspaces.map((ws) => (
          <TabPill
            key={ws.id}
            href={`/tasks?workspace=${ws.kind}`}
            label={ws.name}
            matchKey="workspace"
            matchValue={ws.kind}
          />
        ))}
      </div>

      {/* Shared modal */}
      <NewTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        workspaces={workspaces}
        currentMemberIds={currentMemberIds}
      />

      {/* Main layout */}
      <div className="flex min-h-[calc(100vh-52px)] -m-6">
        {/* Sidebar — medium screens and up */}
        <aside className="hidden md:flex w-[200px] flex-col bg-[var(--color-surface)] border-r border-[var(--color-border)] p-3 flex-shrink-0">
          <button
            onClick={() => setModalOpen(true)}
            className="mb-4 w-full flex items-center justify-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium rounded-[8px] py-[9px] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 1v10M1 6h10" />
            </svg>
            New task
          </button>

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
          {workspaces.map((ws) => (
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

        {children}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/tasks/tasks-page-client.tsx
git commit -m "feat: add TasksPageClient with sidebar, tab strip, and lifted modal state"
```

---

## Task 5: Update `page.tsx` — delegate layout to `TasksPageClient`

**Files:**
- Modify: `src/app/tasks/page.tsx`

The server component keeps all data fetching. The `return` statement is simplified: wrap everything in `TasksPageClient` (which now owns the sidebar + tab strip + modal), and pass only the `<main>` content area as `children`. Remove the old `NewTaskModal` and `SidebarLink` imports.

- [ ] **Step 1: Modify `src/app/tasks/page.tsx`**

Replace the entire `return` statement of `page.tsx`. Keep all data-fetching logic above unchanged. The return now wraps only the `<main>` content in `TasksPageClient` — the sidebar is rendered inside `TasksPageClient` itself (Task 4). Remove the `NewTaskModal` import (modal is now in `TasksPageClient`).

Updated imports at the top of `page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { TaskCard, EmptyState } from "@/components/task-card";
import { bucketTasks, type RawTask } from "./bucket-tasks";
import { CompletedSection } from "./completed-section";
import { TasksPageClient } from "./tasks-page-client";
```

Updated return statement:

```tsx
  return (
    <TasksPageClient
      workspaces={myWorkspaces}
      currentMemberIds={myMemberIds}
      workspaceFilter={workspaceFilter}
      viewFilter={viewFilter}
    >
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
    </TasksPageClient>
  );
```

- [ ] **Step 2: Run all tests**

```bash
npx jest --no-coverage
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/tasks/page.tsx
git commit -m "feat: wire page.tsx to TasksPageClient, remove legacy sidebar from server component"
```

---

## Task 6: Smoke test in browser

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify at full width (≥768px)**
  - Sidebar is visible on the left
  - "New task" button in sidebar opens the modal
  - Modal shows: Title, Description, Due date, Workspace, Assign to, Subtasks
  - Modal scrolls if window is short
  - Adding subtasks inline works (Enter appends a new row, ✕ removes a row)
  - Submitting creates the task (and subtasks) and closes the modal

- [ ] **Step 3: Verify at partial/small width (<768px)**
  - Sidebar is hidden
  - Tab strip is visible below the navbar
  - "New task" in tab strip opens the same modal
  - My Tasks / Shared / workspace pills navigate correctly and show active state
  - Tab strip scrolls horizontally if needed

- [ ] **Step 4: Add `.superpowers/` to `.gitignore` if not present**

```bash
grep -q ".superpowers" .gitignore || echo ".superpowers/" >> .gitignore
git add .gitignore
git commit -m "chore: ignore .superpowers brainstorm directory"
```
