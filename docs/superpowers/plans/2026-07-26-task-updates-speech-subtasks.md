# Phase 6: Task Updates & Speech-to-Text — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can add text updates to a task (typed or dictated via Web Speech API) and add a
subtask to an already-created task, both from `edit-task-modal.tsx`.

**Architecture:** Two new read/write server actions for updates (`getTaskUpdates`,
`addTaskUpdate`), one new write action for subtasks (`addSubtask`, sharing an extracted
`insertSubtask` helper with the existing `createTaskWithSubtasks`), a new `useSpeechRecognition`
hook wrapping the browser's `SpeechRecognition` API, and two new sections in `edit-task-modal.tsx`
that lazy-load and optimistically append to their own local lists.

**Tech Stack:** Next.js 16 server actions, Zod, Supabase (admin client + explicit authz, no new
RLS), Jest + Testing Library, browser `SpeechRecognition`/`webkitSpeechRecognition`.

## Global Constraints

- Every server action: `requireUser()` → `assertTaskAssignee()` (or equivalent) → validate via
  Zod → admin-client mutation, wrapped in the existing `run()` helper. No action skips
  authorization — see `docs/superpowers/specs/2026-07-26-task-updates-speech-subtasks-design.md`.
- No new migration — `task_updates` schema and RLS already exist.
- Client-visible errors in `edit-task-modal.tsx` render inline (`role="alert"`), never via
  `toast()` — the toaster is inert while the modal's native `<dialog>` is open.
- `useSpeechRecognition` must auto-restart from `onend` unless the user explicitly tapped stop
  (Chrome stops on silence even with `continuous: true`), check both `window.SpeechRecognition`
  and `window.webkitSpeechRecognition`, and compute support inside an effect/lazy initializer —
  never read `window` at module scope (SSR safety).
- No `any` types — declare minimal `SpeechRecognition` interfaces locally (not in the standard
  DOM lib here).
- Max lengths: update text 2000 chars, matching `description`'s existing limit in `schemas.ts`.

---

## Task 1: `getTaskUpdates` read action

**Files:**
- Modify: `src/app/tasks/actions.ts` (add `TaskUpdate` type + `getTaskUpdates`, near the end of
  the file, after `reorderTask`)
- Modify: `src/app/tasks/actions.test.ts` (add `describe("getTaskUpdates")`, extend shared `seed()`
  fixture with `display_name`)

**Interfaces:**
- Produces: `export type TaskUpdate = { id: string; authorName: string; createdAt: string;
  updateText: string }` and `export async function getTaskUpdates(rawTaskId: string):
  Promise<ActionResult<{ updates: TaskUpdate[] }>>` — both consumed by Task 2 (return type reused)
  and Task 6 (UI calls this action).
- Consumes: `requireUser`, `assertTaskAssignee`, `parseInput`, `taskIdSchema`, `createAdminClient`,
  `ActionResult`, `run` — all already imported/defined in `actions.ts`.

- [ ] **Step 1: Extend the shared test fixture with `display_name`**

In `src/app/tasks/actions.test.ts`, update `seed()`:

```ts
function seed(): Tables {
  return {
    workspace_members: [
      { id: M1, workspace_id: WS1, auth_user_id: "auth-user-1", display_name: "Alice" },
      { id: M2, workspace_id: WS1, auth_user_id: "auth-user-2", display_name: "Bob" },
      { id: M_OUTSIDER, workspace_id: WS2, auth_user_id: "auth-user-3", display_name: "Carol" },
    ],
    tasks: [
      { id: T1, workspace_id: WS1, parent_task_id: null, completed_at: null, title: "Task 1" },
    ],
    task_assignments: [{ task_id: T1, member_id: M1, member_sort_key: 1000 }],
  };
}
```

- [ ] **Step 2: Write the failing tests**

Add to `src/app/tasks/actions.test.ts` (after the existing `import` line, add `getTaskUpdates` to
the import from `./actions`):

```ts
describe("getTaskUpdates", () => {
  it("returns updates in chronological order with author names", async () => {
    const fake = setup({
      tables: {
        ...seed(),
        task_updates: [
          {
            id: "e0000000-0000-4000-8000-000000000002",
            task_id: T1,
            member_id: M1,
            update_text: "second update",
            created_at: "2026-07-26T10:00:00Z",
          },
          {
            id: "e0000000-0000-4000-8000-000000000001",
            task_id: T1,
            member_id: M1,
            update_text: "first update",
            created_at: "2026-07-26T09:00:00Z",
          },
        ],
      },
    });
    void fake;

    const result = await getTaskUpdates(T1);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.updates.map((u) => u.updateText)).toEqual(["first update", "second update"]);
    expect(result.updates[0].authorName).toBe("Alice");
  });

  it("rejects a user who is not assigned to the task", async () => {
    setup({ tables: { ...seed(), task_updates: [] }, user: { id: "auth-user-3" } });

    const result = await getTaskUpdates(T1);

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/app/tasks/actions.test.ts -t getTaskUpdates`
Expected: FAIL — `getTaskUpdates is not a function` (not yet exported from `./actions`).

- [ ] **Step 4: Implement `getTaskUpdates`**

Add to `src/app/tasks/actions.ts`, after `reorderTask` (end of file):

```ts
export type TaskUpdate = {
  id: string;
  authorName: string;
  createdAt: string;
  updateText: string;
};

export async function getTaskUpdates(rawTaskId: string): Promise<ActionResult<{ updates: TaskUpdate[] }>> {
  return run("getTaskUpdates", async () => {
    const { user } = await requireUser();
    const taskId = parseInput(taskIdSchema, rawTaskId);
    await assertTaskAssignee(taskId, user.id);

    const admin = createAdminClient();

    const { data: rows, error: updatesError } = await admin
      .from("task_updates")
      .select("id, member_id, created_at, update_text")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    assertNoError("load updates", { error: updatesError });

    const memberIds = [...new Set((rows ?? []).map((r) => r.member_id as string))];

    const { data: members, error: membersError } = await admin
      .from("workspace_members")
      .select("id, display_name")
      .in("id", memberIds);

    assertNoError("load update authors", { error: membersError });

    const nameById = new Map((members ?? []).map((m) => [m.id as string, m.display_name as string]));

    const updates: TaskUpdate[] = (rows ?? []).map((r) => ({
      id: r.id as string,
      authorName: nameById.get(r.member_id as string) ?? "Unknown",
      createdAt: r.created_at as string,
      updateText: r.update_text as string,
    }));

    return { updates };
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/app/tasks/actions.test.ts -t getTaskUpdates`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/tasks/actions.ts src/app/tasks/actions.test.ts
git commit -m "feat(tasks): add getTaskUpdates read action"
```

---

## Task 2: `createTaskUpdateSchema` + `addTaskUpdate` write action

**Files:**
- Modify: `src/app/tasks/schemas.ts` (add `createTaskUpdateSchema`, `CreateTaskUpdateInput`)
- Modify: `src/app/tasks/actions.ts` (add `addTaskUpdate`, after `getTaskUpdates`)
- Modify: `src/app/tasks/actions.test.ts` (add `describe("addTaskUpdate")`)

**Interfaces:**
- Consumes: `TaskUpdate` type and `memberIdsForUser` (Task 1 / already imported), `ForbiddenError`
  (already imported).
- Produces: `export const createTaskUpdateSchema` / `export type CreateTaskUpdateInput` (consumed
  by Task 6's UI), `export async function addTaskUpdate(input: CreateTaskUpdateInput):
  Promise<ActionResult<{ update: TaskUpdate }>>` (consumed by Task 6).

- [ ] **Step 1: Write the failing tests**

Add to `src/app/tasks/actions.test.ts` (add `addTaskUpdate` to the `./actions` import):

```ts
describe("addTaskUpdate", () => {
  it("inserts an update authored by the caller's own member row and returns it", async () => {
    setup({ tables: { ...seed(), task_updates: [] } });

    const result = await addTaskUpdate({ taskId: T1, updateText: "Picked up the package" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.update.updateText).toBe("Picked up the package");
    expect(result.update.authorName).toBe("Alice");
  });

  it("rejects empty update text", async () => {
    setup({ tables: { ...seed(), task_updates: [] } });

    const result = await addTaskUpdate({ taskId: T1, updateText: "   " });

    expect(result.ok).toBe(false);
  });

  it("rejects a user who is not assigned to the task", async () => {
    setup({ tables: { ...seed(), task_updates: [] }, user: { id: "auth-user-3" } });

    const result = await addTaskUpdate({ taskId: T1, updateText: "Not my task" });

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/app/tasks/actions.test.ts -t addTaskUpdate`
Expected: FAIL — `addTaskUpdate is not a function`.

- [ ] **Step 3: Add the schema**

In `src/app/tasks/schemas.ts`, after `updateTaskSchema`:

```ts
const updateText = z
  .string()
  .trim()
  .min(1, "Update text is required")
  .max(2000, "Update must be 2000 characters or fewer");

export const createTaskUpdateSchema = z.object({
  taskId: uuid,
  updateText,
});
```

And add to the type-export block near the bottom:

```ts
export type CreateTaskUpdateInput = z.input<typeof createTaskUpdateSchema>;
```

- [ ] **Step 4: Implement `addTaskUpdate`**

In `src/app/tasks/actions.ts`, add `createTaskUpdateSchema` and `CreateTaskUpdateInput` to the
existing imports from `./schemas`, then add after `getTaskUpdates`:

```ts
export async function addTaskUpdate(input: CreateTaskUpdateInput): Promise<ActionResult<{ update: TaskUpdate }>> {
  return run("addTaskUpdate", async () => {
    const { user } = await requireUser();
    const { taskId, updateText } = parseInput(createTaskUpdateSchema, input);
    await assertTaskAssignee(taskId, user.id);

    const ownMemberIds = await memberIdsForUser(user.id);
    const admin = createAdminClient();

    // A task belongs to one workspace and auth_user_id is unique within a workspace
    // (workspace_members: unique(workspace_id, auth_user_id)), so at most one of the caller's own
    // member rows can be assigned to this task — this resolves to exactly one author.
    const { data: assignments, error: assignError } = await admin
      .from("task_assignments")
      .select("member_id")
      .eq("task_id", taskId)
      .in("member_id", ownMemberIds);

    assertNoError("resolve update author", { error: assignError });

    const memberId = assignments?.[0]?.member_id as string | undefined;
    if (!memberId) throw new ForbiddenError(`not assigned to task ${taskId}`);

    const createdAt = new Date().toISOString();
    const updateId = crypto.randomUUID();

    assertNoError(
      "add task update",
      await admin.from("task_updates").insert({
        id: updateId,
        task_id: taskId,
        member_id: memberId,
        update_text: updateText,
        created_at: createdAt,
      })
    );

    const { data: member, error: memberError } = await admin
      .from("workspace_members")
      .select("display_name")
      .eq("id", memberId)
      .single();

    assertNoError("load author name", { error: memberError });

    return {
      update: {
        id: updateId,
        authorName: (member?.display_name as string) ?? "Unknown",
        createdAt,
        updateText,
      },
    };
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/app/tasks/actions.test.ts -t addTaskUpdate`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/tasks/schemas.ts src/app/tasks/actions.ts src/app/tasks/actions.test.ts
git commit -m "feat(tasks): add createTaskUpdateSchema and addTaskUpdate action"
```

---

## Task 3: Extract `insertSubtask` helper (refactor, behavior-preserving)

**Files:**
- Modify: `src/app/tasks/actions.ts:170-243` (`createTaskWithSubtasks`)

**Interfaces:**
- Produces: `async function insertSubtask(admin, args: { parentId: string; workspaceId: string;
  memberIds: string[]; title: string; description?: string; dueAt?: string }): Promise<string>` —
  a private helper, consumed by `createTaskWithSubtasks` (this task) and `addSubtask` (Task 4).
- Consumes: `assertNoError`, `assignTaskMember` — both already defined above this point in the
  file.

This is a pure refactor — no new test file. The existing `createTaskWithSubtasks` tests in
`actions.test.ts` are the regression check.

**Note (post-implementation, added during review adjudication):** wrapping the assignment loop
inside `insertSubtask`'s scope, then wrapping the whole helper call in the caller's try/catch,
means an `assignTaskMember` failure for a subtask now gets caught and counted in `subtaskErrors`
instead of propagating uncaught out of `createTaskWithSubtasks`. This is a deliberate behavior
change, not a regression: the pre-refactor code's own comment ("a failed subtask is reported
rather than thrown... the parent task exists at this point, and discarding it would lose work the
user can see") already established that subtask failures should degrade to a count, not a thrown
error — but the original code only applied that to insert failures, leaving assign failures as an
inconsistency. This refactor closes that gap. Task quality review flagged it as a "Critical"
diff-visible behavior change; adjudicated here as an intentional fix, not a defect — no code change
required.

- [ ] **Step 1: Confirm the baseline passes before changing anything**

Run: `npx jest src/app/tasks/actions.test.ts -t createTaskWithSubtasks`
Expected: PASS (establishes the behavior this refactor must not change)

- [ ] **Step 2: Add the `insertSubtask` helper**

In `src/app/tasks/actions.ts`, add after the `assignTaskMember` function (before
`completeTask`):

```ts
/**
 * Inserts a subtask row and assigns it the given members. Shared by `createTaskWithSubtasks`
 * (batch, at parent-creation time) and `addSubtask` (single, on an already-existing task) — both
 * need the identical insert-then-assign shape, just triggered at different times.
 */
async function insertSubtask(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    parentId: string;
    workspaceId: string;
    memberIds: string[];
    title: string;
    description?: string;
    dueAt?: string;
  }
): Promise<string> {
  const subtaskId = crypto.randomUUID();

  assertNoError(
    "create subtask",
    await admin.from("tasks").insert({
      id: subtaskId,
      title: args.title,
      description: args.description ?? null,
      due_at: args.dueAt ? `${args.dueAt}T00:00:00Z` : null,
      workspace_id: args.workspaceId,
      parent_task_id: args.parentId,
    })
  );

  for (const memberId of args.memberIds) {
    await assignTaskMember(admin, subtaskId, memberId);
  }

  return subtaskId;
}
```

- [ ] **Step 3: Replace `createTaskWithSubtasks`'s subtask loop to use it**

Replace the existing loop (currently inline insert + assign, ~lines 208-238) with:

```ts
    let subtaskErrors = 0;
    for (const sub of subtasks) {
      try {
        await insertSubtask(admin, {
          parentId,
          workspaceId,
          memberIds: uniqueMemberIds,
          title: sub.title,
          description: sub.description,
          dueAt: sub.dueAt,
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            action: "createTaskWithSubtasks",
            step: "create subtask",
            parentId,
            message: err instanceof Error ? err.message : String(err),
          })
        );
        subtaskErrors++;
      }
    }
```

- [ ] **Step 4: Run the full `createTaskWithSubtasks` suite to confirm no behavior changed**

Run: `npx jest src/app/tasks/actions.test.ts -t createTaskWithSubtasks`
Expected: PASS, same as the baseline in Step 1

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/actions.ts
git commit -m "refactor(tasks): extract insertSubtask helper from createTaskWithSubtasks"
```

---

## Task 4: `addSubtaskSchema` + `addSubtask` write action

**Files:**
- Modify: `src/app/tasks/schemas.ts` (add `addSubtaskSchema`, `AddSubtaskInput`)
- Modify: `src/app/tasks/actions.ts` (add `addSubtask`, after `addTaskUpdate`)
- Modify: `src/app/tasks/actions.test.ts` (add `describe("addSubtask")`)

**Interfaces:**
- Consumes: `insertSubtask` (Task 3).
- Produces: `export const addSubtaskSchema` / `export type AddSubtaskInput` (consumed by Task 7's
  UI), `export async function addSubtask(input: AddSubtaskInput): Promise<ActionResult<{ subtask:
  { id: string; title: string; completed_at: string | null } }>>` (consumed by Task 7).

- [ ] **Step 1: Write the failing tests**

Add to `src/app/tasks/actions.test.ts` (add `addSubtask` to the `./actions` import):

```ts
describe("addSubtask", () => {
  it("creates a subtask assigned to the parent's current assignees", async () => {
    setup();

    const result = await addSubtask({ parentTaskId: T1, title: "New subtask" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.subtask.title).toBe("New subtask");
    expect(result.subtask.completed_at).toBeNull();
  });

  it("rejects an empty title", async () => {
    setup();

    const result = await addSubtask({ parentTaskId: T1, title: "  " });

    expect(result.ok).toBe(false);
  });

  it("rejects a user who is not assigned to the parent task", async () => {
    setup({ user: { id: "auth-user-3" } });

    const result = await addSubtask({ parentTaskId: T1, title: "Not my task" });

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/app/tasks/actions.test.ts -t addSubtask`
Expected: FAIL — `addSubtask is not a function`.

- [ ] **Step 3: Add the schema**

In `src/app/tasks/schemas.ts`, after `createTaskUpdateSchema`:

```ts
export const addSubtaskSchema = z.object({
  parentTaskId: uuid,
  title,
  description,
  dueAt,
});
```

And to the type-export block:

```ts
export type AddSubtaskInput = z.input<typeof addSubtaskSchema>;
```

- [ ] **Step 4: Implement `addSubtask`**

In `src/app/tasks/actions.ts`, add `addSubtaskSchema` and `AddSubtaskInput` to the imports from
`./schemas`, then add after `addTaskUpdate`:

```ts
export async function addSubtask(
  input: AddSubtaskInput
): Promise<ActionResult<{ subtask: { id: string; title: string; completed_at: string | null } }>> {
  return run("addSubtask", async () => {
    const { user } = await requireUser();
    const { parentTaskId, title, description, dueAt } = parseInput(addSubtaskSchema, input);
    await assertTaskAssignee(parentTaskId, user.id);

    const admin = createAdminClient();

    const { data: parent, error: parentError } = await admin
      .from("tasks")
      .select("workspace_id")
      .eq("id", parentTaskId)
      .single();

    if (parentError || !parent) throw new Error(parentError?.message ?? "Task not found");

    const { data: assignments, error: assignError } = await admin
      .from("task_assignments")
      .select("member_id")
      .eq("task_id", parentTaskId);

    assertNoError("load parent assignments", { error: assignError });
    const memberIds = (assignments ?? []).map((a) => a.member_id as string);

    const subtaskId = await insertSubtask(admin, {
      parentId: parentTaskId,
      workspaceId: parent.workspace_id as string,
      memberIds,
      title,
      description,
      dueAt,
    });

    revalidatePath("/tasks");
    return { subtask: { id: subtaskId, title, completed_at: null } };
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/app/tasks/actions.test.ts -t addSubtask`
Expected: PASS

- [ ] **Step 6: Run the full actions suite to confirm nothing else broke**

Run: `npx jest src/app/tasks/actions.test.ts`
Expected: PASS (all tests, including Tasks 1-3's)

- [ ] **Step 7: Commit**

```bash
git add src/app/tasks/schemas.ts src/app/tasks/actions.ts src/app/tasks/actions.test.ts
git commit -m "feat(tasks): add addSubtaskSchema and addSubtask action"
```

---

## Task 5: `useSpeechRecognition` hook

**Files:**
- Create: `src/lib/use-speech-recognition.ts`
- Create: `src/lib/use-speech-recognition.test.ts`

**Interfaces:**
- Produces: `export function useSpeechRecognition(onResult: (transcript: string, isFinal: boolean)
  => void): { isSupported: boolean; isListening: boolean; error: string | null; start: () => void;
  stop: () => void }` — consumed by Task 6's UI.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/use-speech-recognition.test.ts`:

```ts
import { renderHook, act } from "@testing-library/react";
import { useSpeechRecognition } from "./use-speech-recognition";

type Listener = (event: unknown) => void;

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  onresult: Listener | null = null;
  onend: (() => void) | null = null;
  onerror: Listener | null = null;
  start = jest.fn();
  stop = jest.fn(() => this.onend?.());
}

describe("useSpeechRecognition", () => {
  const originalSR = (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;

  afterEach(() => {
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = originalSR;
  });

  it("reports unsupported when no SpeechRecognition constructor exists", () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    const { result } = renderHook(() => useSpeechRecognition(() => {}));

    expect(result.current.isSupported).toBe(false);
  });

  it("starts listening and forwards results to onResult", () => {
    let instance: MockSpeechRecognition | null = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      instance = new MockSpeechRecognition();
      return instance;
    });

    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    expect(result.current.isSupported).toBe(true);

    act(() => result.current.start());
    expect(result.current.isListening).toBe(true);
    expect(instance!.start).toHaveBeenCalled();

    act(() => {
      instance!.onresult?.({
        results: [[{ transcript: "hello" }]].map((r) => Object.assign(r, { isFinal: true, 0: r[0] })),
      });
    });
    expect(onResult).toHaveBeenCalledWith("hello", true);
  });

  it("auto-restarts on onend unless the user explicitly stopped", () => {
    let instance: MockSpeechRecognition | null = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      instance = new MockSpeechRecognition();
      return instance;
    });

    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => result.current.start());
    instance!.start.mockClear();

    // Simulate Chrome ending the session on silence.
    act(() => instance!.onend?.());

    expect(instance!.start).toHaveBeenCalledTimes(1);
    expect(result.current.isListening).toBe(true);
  });

  it("does not restart after the user explicitly calls stop", () => {
    let instance: MockSpeechRecognition | null = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      instance = new MockSpeechRecognition();
      return instance;
    });

    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => result.current.start());
    act(() => result.current.stop());

    expect(result.current.isListening).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/lib/use-speech-recognition.test.ts`
Expected: FAIL — module `./use-speech-recognition` not found.

- [ ] **Step 3: Implement the hook**

Create `src/lib/use-speech-recognition.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function getConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * Wraps the browser's SpeechRecognition API. Chrome ends a session on silence even with
 * `continuous: true`, so `onend` auto-restarts unless `stop()` was called explicitly — tracked via
 * `stoppedByUserRef` rather than `isListening` state, since state updates inside the `onend`
 * callback would be stale by the time the callback reads them.
 */
export function useSpeechRecognition(onResult: (transcript: string, isFinal: boolean) => void) {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stoppedByUserRef = useRef(true);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    setIsSupported(getConstructor() !== null);
  }, []);

  const start = useCallback(() => {
    const Ctor = getConstructor();
    if (!Ctor) return;

    setError(null);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      onResultRef.current(result[0].transcript, result.isFinal);
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") setError("Microphone access was denied");
    };

    recognition.onend = () => {
      if (!stoppedByUserRef.current) {
        recognition.start();
        return;
      }
      setIsListening(false);
    };

    stoppedByUserRef.current = false;
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, []);

  const stop = useCallback(() => {
    stoppedByUserRef.current = true;
    recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      stoppedByUserRef.current = true;
      recognitionRef.current?.stop();
    };
  }, []);

  return { isSupported, isListening, error, start, stop };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/lib/use-speech-recognition.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-speech-recognition.ts src/lib/use-speech-recognition.test.ts
git commit -m "feat: add useSpeechRecognition hook"
```

---

## Task 6: Edit-task-modal — Updates section

**Files:**
- Modify: `src/app/tasks/edit-task-modal.tsx`
- Modify: `src/app/tasks/edit-task-modal.test.tsx`

**Interfaces:**
- Consumes: `getTaskUpdates`, `addTaskUpdate`, `TaskUpdate`, `createTaskUpdateSchema` (Tasks 1-2),
  `useSpeechRecognition` (Task 5).

- [ ] **Step 1: Write the failing tests**

Add to `src/app/tasks/edit-task-modal.test.tsx`. First, extend the top-of-file mock:

```ts
jest.mock("./actions", () => ({
  updateTask: jest.fn(),
  getTaskUpdates: jest.fn(),
  addTaskUpdate: jest.fn(),
  addSubtask: jest.fn(),
}));
```

Update the `import { updateTask } from "./actions"` line to:

```ts
import { updateTask, getTaskUpdates, addTaskUpdate, addSubtask } from "./actions";
```

Add a new `describe` block:

```ts
describe("EditTaskModal — Updates", () => {
  beforeEach(() => jest.clearAllMocks());

  it("loads and shows existing updates when opened", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({
      ok: true,
      updates: [
        { id: "u1", authorName: "Alice", createdAt: "2026-07-26T09:00:00Z", updateText: "First update" },
      ],
    });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    expect(await screen.findByText("First update")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("optimistically appends a new update and calls addTaskUpdate", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
    jest.mocked(addTaskUpdate).mockResolvedValue({
      ok: true,
      update: { id: "u2", authorName: "Alice", createdAt: "2026-07-26T11:00:00Z", updateText: "Picked it up" },
    });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    await screen.findByPlaceholderText(/add an update/i);
    await userEvent.type(screen.getByPlaceholderText(/add an update/i), "Picked it up");
    await userEvent.click(screen.getByRole("button", { name: /^add update$/i }));

    expect(await screen.findByText("Picked it up")).toBeInTheDocument();
    expect(addTaskUpdate).toHaveBeenCalledWith({ taskId: mockTask.id, updateText: "Picked it up" });
  });

  it("rolls back the optimistic update and shows an inline error on failure", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
    jest.mocked(addTaskUpdate).mockResolvedValue({ ok: false, error: "Something went wrong" });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    await screen.findByPlaceholderText(/add an update/i);
    await userEvent.type(screen.getByPlaceholderText(/add an update/i), "Will fail");
    await userEvent.click(screen.getByRole("button", { name: /^add update$/i }));

    await screen.findByText("Something went wrong");
    expect(screen.queryByText("Will fail")).not.toBeInTheDocument();
  });

  it("does not render a mic button when SpeechRecognition is unsupported", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    await screen.findByPlaceholderText(/add an update/i);
    expect(screen.queryByRole("button", { name: /dictate/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/app/tasks/edit-task-modal.test.tsx -t Updates`
Expected: FAIL — no updates UI exists yet.

- [ ] **Step 3: Implement the Updates section**

In `src/app/tasks/edit-task-modal.tsx`, update imports:

```ts
import { useEffect, useState, useTransition } from "react";
import { updateTask, getTaskUpdates, addTaskUpdate } from "./actions";
import { updateTaskSchema } from "./schemas";
import { toast } from "@/components/toaster";
import { Dialog } from "@/components/dialog";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";
import type { RawTask } from "./bucket-tasks";
import type { TaskUpdate } from "./actions";
```

Inside `EditTaskModal`, add state and effects (after the existing `formError` state):

```ts
  const [updates, setUpdates] = useState<TaskUpdate[]>([]);
  const [updateDraft, setUpdateDraft] = useState("");
  const [updateError, setUpdateError] = useState("");
  const [updatesPending, startUpdateTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getTaskUpdates(task.id).then((result) => {
      if (!cancelled && result.ok) setUpdates(result.updates);
    });
    return () => {
      cancelled = true;
    };
  }, [open, task.id]);

  const speech = useSpeechRecognition((transcript, isFinal) => {
    setUpdateDraft((prev) => (isFinal ? `${prev}${transcript} ` : prev.replace(/\s*$/, "") + " " + transcript));
  });

  function handleAddUpdate() {
    const parsed = createTaskUpdateSchema.safeParse({ taskId: task.id, updateText: updateDraft });
    if (!parsed.success) {
      setUpdateError(parsed.error.issues[0].message);
      return;
    }
    setUpdateError("");

    const tempId = crypto.randomUUID();
    const optimisticUpdate: TaskUpdate = {
      id: tempId,
      authorName: "You",
      createdAt: new Date().toISOString(),
      updateText: parsed.data.updateText,
    };
    setUpdates((prev) => [...prev, optimisticUpdate]);
    setUpdateDraft("");

    startUpdateTransition(async () => {
      const result = await addTaskUpdate(parsed.data);
      if (!result.ok) {
        setUpdates((prev) => prev.filter((u) => u.id !== tempId));
        setUpdateError(result.error);
        return;
      }
      setUpdates((prev) => prev.map((u) => (u.id === tempId ? result.update : u)));
    });
  }
```

Add `createTaskUpdateSchema` to the `./schemas` import:

```ts
import { updateTaskSchema, createTaskUpdateSchema } from "./schemas";
```

Add the Updates section JSX inside the `<Dialog>`, after the existing `</form>`:

```tsx
      <div className="mt-6 border-t border-[var(--color-border)] pt-4">
        <h4 className="text-sm font-semibold mb-2">Updates</h4>
        <ul className="flex flex-col gap-2 mb-3 max-h-40 overflow-y-auto">
          {updates.map((u) => (
            <li key={u.id} className="text-sm">
              <span className="font-medium">{u.authorName}</span>{" "}
              <span className="text-[var(--color-text-muted)]">
                {new Date(u.createdAt).toLocaleString()}
              </span>
              <p>{u.updateText}</p>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <textarea
            placeholder="Add an update…"
            value={updateDraft}
            onChange={(e) => setUpdateDraft(e.target.value)}
            disabled={updatesPending}
            rows={2}
            className="flex-1 border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] resize-none disabled:opacity-50"
          />
          {speech.isSupported && (
            <button
              type="button"
              aria-label={speech.isListening ? "Stop dictating" : "Dictate update"}
              onClick={() => (speech.isListening ? speech.stop() : speech.start())}
              disabled={updatesPending}
              className={`px-3 rounded-[8px] border border-[var(--color-border)] text-sm disabled:opacity-50 ${speech.isListening ? "bg-red-50 text-red-600" : ""}`}
            >
              {speech.isListening ? "●" : "🎤"}
            </button>
          )}
          <button
            type="button"
            onClick={handleAddUpdate}
            disabled={!updateDraft.trim() || updatesPending}
            className="px-4 rounded-[8px] bg-[var(--color-accent)] text-white text-sm disabled:opacity-40"
          >
            Add update
          </button>
        </div>
        {updateError && (
          <p role="alert" className="mt-2 rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-600">
            {updateError}
          </p>
        )}
        {speech.error && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {speech.error}
          </p>
        )}
      </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/app/tasks/edit-task-modal.test.tsx`
Expected: PASS (all tests, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/edit-task-modal.tsx src/app/tasks/edit-task-modal.test.tsx
git commit -m "feat(tasks): add updates section to edit-task-modal with speech-to-text"
```

---

## Task 7: Edit-task-modal — Subtasks section

**Files:**
- Modify: `src/app/tasks/edit-task-modal.tsx`
- Modify: `src/app/tasks/edit-task-modal.test.tsx`

**Interfaces:**
- Consumes: `addSubtask`, `addSubtaskSchema` (Task 4).

- [ ] **Step 1: Write the failing tests**

Add to `src/app/tasks/edit-task-modal.test.tsx`:

```ts
describe("EditTaskModal — Subtasks", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows existing subtasks from the task prop", () => {
    const taskWithSubtasks = { ...mockTask, subtasks: [{ id: "s1", title: "Existing subtask", completed_at: null }] };
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });

    render(
      <EditTaskModal open task={taskWithSubtasks} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    expect(screen.getByText("Existing subtask")).toBeInTheDocument();
  });

  it("optimistically appends a new subtask and calls addSubtask", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
    jest.mocked(addSubtask).mockResolvedValue({ ok: true, subtask: { id: "s2", title: "New subtask", completed_at: null } });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    await userEvent.type(screen.getByPlaceholderText(/new subtask title/i), "New subtask");
    await userEvent.click(screen.getByRole("button", { name: /^add subtask$/i }));

    expect(await screen.findByText("New subtask")).toBeInTheDocument();
    expect(addSubtask).toHaveBeenCalledWith(
      expect.objectContaining({ parentTaskId: mockTask.id, title: "New subtask" })
    );
  });

  it("rolls back the optimistic subtask and shows an inline error on failure", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
    jest.mocked(addSubtask).mockResolvedValue({ ok: false, error: "Something went wrong" });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    await userEvent.type(screen.getByPlaceholderText(/new subtask title/i), "Will fail");
    await userEvent.click(screen.getByRole("button", { name: /^add subtask$/i }));

    await screen.findByText("Something went wrong");
    expect(screen.queryByText("Will fail")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/app/tasks/edit-task-modal.test.tsx -t Subtasks`
Expected: FAIL — no subtasks-add UI exists yet.

- [ ] **Step 3: Implement the Subtasks section**

Update the `./actions` import in `edit-task-modal.tsx`:

```ts
import { updateTask, getTaskUpdates, addTaskUpdate, addSubtask } from "./actions";
```

Add `addSubtaskSchema` to the `./schemas` import:

```ts
import { updateTaskSchema, createTaskUpdateSchema, addSubtaskSchema } from "./schemas";
```

Add state and a submit handler (after the updates-related state from Task 6):

```ts
  const [subtasks, setSubtasks] = useState(task.subtasks);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskError, setSubtaskError] = useState("");
  const [subtaskPending, startSubtaskTransition] = useTransition();

  function handleAddSubtask() {
    const parsed = addSubtaskSchema.safeParse({ parentTaskId: task.id, title: subtaskTitle });
    if (!parsed.success) {
      setSubtaskError(parsed.error.issues[0].message);
      return;
    }
    setSubtaskError("");

    const tempId = crypto.randomUUID();
    setSubtasks((prev) => [...prev, { id: tempId, title: parsed.data.title, completed_at: null }]);
    setSubtaskTitle("");

    startSubtaskTransition(async () => {
      const result = await addSubtask(parsed.data);
      if (!result.ok) {
        setSubtasks((prev) => prev.filter((s) => s.id !== tempId));
        setSubtaskError(result.error);
        return;
      }
      setSubtasks((prev) => prev.map((s) => (s.id === tempId ? result.subtask : s)));
    });
  }
```

Add the Subtasks section JSX, after the Updates section from Task 6:

```tsx
      <div className="mt-6 border-t border-[var(--color-border)] pt-4">
        <h4 className="text-sm font-semibold mb-2">Subtasks</h4>
        <ul className="flex flex-col gap-1 mb-3">
          {subtasks.map((s) => (
            <li key={s.id} className="text-sm flex items-center gap-2">
              <span className={s.completed_at ? "line-through text-[var(--color-text-muted)]" : ""}>
                {s.title}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="New subtask title"
            value={subtaskTitle}
            onChange={(e) => setSubtaskTitle(e.target.value)}
            disabled={subtaskPending}
            className="flex-1 border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleAddSubtask}
            disabled={!subtaskTitle.trim() || subtaskPending}
            className="px-4 rounded-[8px] bg-[var(--color-accent)] text-white text-sm disabled:opacity-40"
          >
            Add subtask
          </button>
        </div>
        {subtaskError && (
          <p role="alert" className="mt-2 rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-600">
            {subtaskError}
          </p>
        )}
      </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/app/tasks/edit-task-modal.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npx jest`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/tasks/edit-task-modal.tsx src/app/tasks/edit-task-modal.test.tsx
git commit -m "feat(tasks): add subtasks section to edit-task-modal"
```

---

## Task 8: Manual verification checklist

**Files:**
- Create: `.planning/phases/06-task-updates-speech-to-text/06-VERIFICATION.md` (directory may need
  creating)

Speech-to-text dictation accuracy and permission-prompt behavior aren't meaningfully testable
against a mock — same pattern as `04-VERIFICATION.md` / `05-VERIFICATION.md`.

- [ ] **Step 1: Create the checklist**

```bash
mkdir -p .planning/phases/06-task-updates-speech-to-text
```

Create `.planning/phases/06-task-updates-speech-to-text/06-VERIFICATION.md`:

```markdown
# Phase 6 Manual Verification

Run through these in a real browser — none are meaningfully testable against a mock.

- [ ] **Chrome — mic button appears, tap starts listening, tap again stops.** Speak a full
  sentence with a natural pause in the middle; confirm the session doesn't silently end after the
  pause (auto-restart working) and the full sentence lands in the textarea.
- [ ] **Chrome — deny microphone permission.** Confirm the inline error ("Microphone access was
  denied") appears instead of a silent failure.
- [ ] **Safari (macOS or iOS) — mic button appears and works** (confirms the
  `webkitSpeechRecognition` prefix path).
- [ ] **Firefox — no mic button renders**, typing still works normally.
- [ ] **Add a text update without dictation**, confirm it appears immediately (optimistic) and
  survives a page refresh (persisted).
- [ ] **Add a subtask to an existing task** from the edit modal, confirm it appears in the task
  card's subtask list after closing the modal.
- [ ] **Two workspace members both assigned to the same task** — confirm each sees the other's
  updates with the correct author name.
```

- [ ] **Step 2: Commit**

```bash
git add .planning/phases/06-task-updates-speech-to-text/06-VERIFICATION.md
git commit -m "docs(phase-06): add manual verification checklist"
```

---

## Self-Review Notes

- **Spec coverage:** Updates list (Task 1, 6) — done. Speech-to-text at input, audio never stored
  (Task 5, 6) — done, no audio ever leaves the browser API. Add subtask to existing task (Task 3,
  4, 7) — done. All three UI surfaces live in `edit-task-modal.tsx` as specified.
- **Type consistency checked:** `TaskUpdate` (Task 1) is the same shape used by `getTaskUpdates`,
  `addTaskUpdate`, and the UI in Task 6. `addSubtask`'s return shape
  (`{ id, title, completed_at }`) matches `RawTask["subtasks"]`'s element type exactly, so Task 7's
  optimistic-then-reconciled array stays one consistent type throughout.
- **Out-of-scope items from the design spec are not tasked here:** editing/deleting updates or
  subtasks, server transcription API, Phase 6.5 UI polish.

## Resolved: stuck `isListening` after `stop()` (fixed 2026-07-26, after the fix loop)

Fixed by making `stop()` own the listening -> idle transition (`setIsListening(false)` inside
`stop()` itself), and by changing the test suite's `MockSpeechRecognition.stop()` to fire `onend`
asynchronously (`queueMicrotask`) so real-browser timing is reproduced. Two existing tests plus one
new regression test (`clears isListening on stop() even though onend fires asynchronously
afterwards`) failed under the async mock before the fix and pass after it. This matches how
`react-speech-recognition`'s `RecognitionManager` handles it: `listening` is set from `start()` /
`stop()` / `abort()` directly, never from the `end` handler, which is reserved for deciding whether
to auto-restart. Original write-up follows.

## Known Issue (parked during final-review fix loop, then fixed — see above)

`useSpeechRecognition`'s `stop()` (`src/lib/use-speech-recognition.ts`) does not itself call
`setIsListening(false)` — it relies on the subsequent `onend` event to do so. The fix-loop's
instance-identity guard added to `onend` (`if (recognitionRef.current !== recognition) return;`,
needed to stop a superseded recognizer from resurrecting itself — see git history on this branch)
means that in a real browser, where `onend` fires *asynchronously* after `stop()` returns and by
then `recognitionRef.current` has already been nulled by `stop()`, the guard's early return
prevents `onend` from ever reaching `setIsListening(false)`. Net effect: after tapping the mic
button to stop dictation, `isListening` can get stuck `true`, and since `edit-task-modal.tsx`
drives the mic button's UI and `stop()` call off that same state, the button can appear stuck in
"listening" and further taps become no-ops until the modal is closed and reopened.

Root cause: this hook's test suite's `MockSpeechRecognition.stop()` fires `onend` *synchronously*
(inside the same call), which does not reproduce real-browser async timing and has repeatedly
masked bugs in this exact area across three fix-loop rounds on this branch. The correct fix
(deferred, not applied here) is to make `stop()` own the `isListening` transition directly —
`setIsListening(false)` inside `stop()` itself, not deferred to `onend` — plus a test using
asynchronous `onend` timing (e.g. a `setTimeout`-deferred mock) so this class of bug can't hide
behind synchronous test mocks again. Tracked as a follow-up; not blocking this phase's merge per
human-partner decision during the final-review fix loop.
