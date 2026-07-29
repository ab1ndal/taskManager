jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { createFakeSupabase, type FailureHook, type Row, type Tables } from "@/test/supabase-fake";
import { completeTask, deleteTask, createTaskWithSubtasks, updateTask, reorderTask, getTaskUpdates, addTaskUpdate, addSubtask, reopenTask } from "./actions";
import { GENERIC_ERROR } from "./action-result";

beforeEach(() => jest.clearAllMocks());

// Ids must be real UUIDs — the actions validate them against the schemas in ./schemas.
const WS1 = "a0000000-0000-4000-8000-000000000001";
const WS2 = "a0000000-0000-4000-8000-000000000002";
const M1 = "b0000000-0000-4000-8000-000000000001";
const M2 = "b0000000-0000-4000-8000-000000000002";
const M_OUTSIDER = "b0000000-0000-4000-8000-000000000003";
const M1_WS2 = "b0000000-0000-4000-8000-000000000004";
const T1 = "c0000000-0000-4000-8000-000000000001";
const T_OTHER = "c0000000-0000-4000-8000-000000000002";
const P1 = "d0000000-0000-4000-8000-000000000001";
const S1 = "d0000000-0000-4000-8000-000000000002";
const S2 = "d0000000-0000-4000-8000-000000000003";

/**
 * Default fixture: two members of WS1 (M1 is the signed-in user, M2 a colleague), one outsider in
 * WS2, and one task T1 assigned to M1.
 */
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

function setup(options: { tables?: Tables; user?: { id: string } | null; failOn?: FailureHook } = {}) {
  const fake = createFakeSupabase({
    tables: options.tables ?? seed(),
    user: options.user === undefined ? { id: "auth-user-1" } : options.user,
    failOn: options.failOn,
  });

  (createClient as jest.Mock).mockResolvedValue(fake);
  (createAdminClient as jest.Mock).mockReturnValue(fake);

  return fake;
}

/**
 * Actions return { ok: false, error } instead of throwing, so failures are asserted on the
 * resolved value. `expected` is matched as a substring of the message.
 */
async function expectFailure(promise: Promise<{ ok: boolean }>, expected: string) {
  const result = await promise;
  expect(result).toEqual({ ok: false, error: expect.stringContaining(expected) });
}

const tasksIn = (t: Tables) => t.tasks as Row[];
const assignmentsIn = (t: Tables) => t.task_assignments as Row[];

// ─── completeTask ────────────────────────────────────────────────────────────

describe("completeTask", () => {
  it("marks task complete and revalidates", async () => {
    const { tables } = setup();

    await completeTask(T1);

    expect(tasksIn(tables)[0].completed_at).toEqual(expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("auto-completes parent when all siblings are done", async () => {
    const tables = seed();
    tables.tasks.push(
      { id: P1, workspace_id: WS1, parent_task_id: null, completed_at: null },
      { id: S1, workspace_id: WS1, parent_task_id: P1, completed_at: null },
      { id: S2, workspace_id: WS1, parent_task_id: P1, completed_at: "2026-01-01T00:00:00Z" }
    );
    tables.task_assignments.push({ task_id: S1, member_id: M1, member_sort_key: 2000 });
    setup({ tables });

    await completeTask(S1);

    const parent = tasksIn(tables).find((t) => t.id === P1);
    expect(parent?.completed_at).toEqual(expect.any(String));
  });

  it("does not auto-complete parent when siblings remain", async () => {
    const tables = seed();
    tables.tasks.push(
      { id: P1, workspace_id: WS1, parent_task_id: null, completed_at: null },
      { id: S1, workspace_id: WS1, parent_task_id: P1, completed_at: null },
      { id: S2, workspace_id: WS1, parent_task_id: P1, completed_at: null }
    );
    tables.task_assignments.push({ task_id: S1, member_id: M1, member_sort_key: 2000 });
    setup({ tables });

    await completeTask(S1);

    const parent = tasksIn(tables).find((t) => t.id === P1);
    expect(parent?.completed_at).toBeNull();
  });

  it("rejects an unauthenticated caller", async () => {
    const { tables } = setup({ user: null });

    await expectFailure(completeTask(T1), "Unauthorized");

    expect(tasksIn(tables)[0].completed_at).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not assigned to the task", async () => {
    const tables = seed();
    tables.tasks.push({ id: T_OTHER, workspace_id: WS1, parent_task_id: null, completed_at: null });
    tables.task_assignments.push({ task_id: T_OTHER, member_id: M2, member_sort_key: 1000 });
    setup({ tables });

    await expectFailure(completeTask(T_OTHER), "Forbidden");

    expect(tasksIn(tables).find((t) => t.id === T_OTHER)?.completed_at).toBeNull();
  });
});

// ─── deleteTask ──────────────────────────────────────────────────────────────

describe("deleteTask", () => {
  it("deletes task and revalidates /tasks", async () => {
    const { tables } = setup();

    await deleteTask(T1);

    expect(tasksIn(tables)).toHaveLength(0);
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("rejects an unauthenticated caller", async () => {
    const { tables } = setup({ user: null });

    await expectFailure(deleteTask(T1), "Unauthorized");

    expect(tasksIn(tables)).toHaveLength(1);
  });

  it("rejects a caller who is not assigned to the task", async () => {
    const tables = seed();
    tables.tasks.push({ id: T_OTHER, workspace_id: WS1, parent_task_id: null, completed_at: null });
    tables.task_assignments.push({ task_id: T_OTHER, member_id: M2, member_sort_key: 1000 });
    setup({ tables });

    await expectFailure(deleteTask(T_OTHER), "Forbidden");

    expect(tasksIn(tables).find((t) => t.id === T_OTHER)).toBeDefined();
  });
});

// ─── createTaskWithSubtasks ──────────────────────────────────────────────────

describe("createTaskWithSubtasks", () => {
  it("inserts parent task + assignment and returns subtaskErrors: 0 when no subtasks", async () => {
    const { tables } = setup();

    const result = await createTaskWithSubtasks({
      title: "Parent task",
      workspaceId: WS1,
      memberIds: [M1],
      subtasks: [],
    });

    const parent = tasksIn(tables).find((t) => t.title === "Parent task");
    expect(parent).toMatchObject({ workspace_id: WS1, description: null, due_at: null });
    expect(assignmentsIn(tables)).toContainEqual(
      expect.objectContaining({ task_id: parent!.id, member_id: M1 })
    );
    expect(result).toEqual({ ok: true, subtaskErrors: 0 });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("inserts subtasks with parent_task_id and converts bare date to UTC midnight", async () => {
    const { tables } = setup();

    const result = await createTaskWithSubtasks({
      title: "Parent",
      description: "Arrange catering and venue",
      workspaceId: WS1,
      memberIds: [M1],
      subtasks: [{ title: "Subtask A", dueAt: "2026-03-25" }],
    });

    const parent = tasksIn(tables).find((t) => t.title === "Parent");
    const subtask = tasksIn(tables).find((t) => t.title === "Subtask A");

    expect(parent).toMatchObject({ description: "Arrange catering and venue" });
    expect(subtask).toMatchObject({
      parent_task_id: parent!.id,
      due_at: "2026-03-25T00:00:00Z",
    });
    expect(assignmentsIn(tables)).toContainEqual(
      expect.objectContaining({ task_id: subtask!.id, member_id: M1 })
    );
    expect(result).toEqual({ ok: true, subtaskErrors: 0 });
  });

  it("stores the parent due date as UTC midnight and null when omitted", async () => {
    const { tables } = setup();

    await createTaskWithSubtasks({
      title: "Meeting",
      dueAt: "2026-06-15",
      workspaceId: WS1,
      memberIds: [M1],
      subtasks: [{ title: "No-date subtask" }],
    });

    expect(tasksIn(tables).find((t) => t.title === "Meeting")).toMatchObject({
      due_at: "2026-06-15T00:00:00Z",
    });
    expect(tasksIn(tables).find((t) => t.title === "No-date subtask")).toMatchObject({ due_at: null });
  });

  it("gives each member their own sort key, continuing from their existing tasks", async () => {
    const tables = seed();
    // m-1 already has a task at 1000; m-2 has none.
    setup({ tables });

    await createTaskWithSubtasks({
      title: "Shared",
      workspaceId: WS1,
      memberIds: [M1, M2],
      subtasks: [],
    });

    const shared = tasksIn(tables).find((t) => t.title === "Shared");
    const forShared = assignmentsIn(tables).filter((a) => a.task_id === shared!.id);

    expect(forShared).toContainEqual(
      expect.objectContaining({ member_id: M1, member_sort_key: 2000 })
    );
    expect(forShared).toContainEqual(
      expect.objectContaining({ member_id: M2, member_sort_key: 1000 })
    );
  });

  it("creates only one assignment per member when memberIds has duplicates", async () => {
    const { tables } = setup();

    await createTaskWithSubtasks({
      title: "Dedup test",
      workspaceId: WS1,
      memberIds: [M1, M1, M1],
      subtasks: [],
    });

    const task = tasksIn(tables).find((t) => t.title === "Dedup test");
    expect(assignmentsIn(tables).filter((a) => a.task_id === task!.id)).toHaveLength(1);
  });

  it("returns subtaskErrors: 1 when a subtask insert fails", async () => {
    const tables = seed();
    let taskInserts = 0;
    setup({
      tables,
      failOn: (table, op) => {
        if (table !== "tasks" || op !== "insert") return null;
        // First insert is the parent; fail the subtask that follows it.
        return ++taskInserts === 2 ? { message: "DB error" } : null;
      },
    });

    const result = await createTaskWithSubtasks({
      title: "Parent",
      workspaceId: WS1,
      memberIds: [M1],
      subtasks: [{ title: "Bad subtask" }],
    });

    expect(result).toEqual({ ok: true, subtaskErrors: 1 });
    expect(tasksIn(tables).find((t) => t.title === "Bad subtask")).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("returns a generic failure and logs the cause when the parent task insert fails", async () => {
    setup({
      failOn: (table, op) =>
        table === "tasks" && op === "insert" ? { message: "constraint violation" } : null,
    });
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    // The database message is logged, never returned — it carries schema detail.
    await expectFailure(createTaskWithSubtasks({
        title: "Failing parent",
        workspaceId: WS1,
        memberIds: [M1],
        subtasks: [],
      }), GENERIC_ERROR);

    expect(logged).toHaveBeenCalledWith(expect.stringContaining("constraint violation"));
    expect(revalidatePath).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("rejects an unauthenticated caller", async () => {
    const { tables } = setup({ user: null });

    await expectFailure(createTaskWithSubtasks({ title: "X", workspaceId: WS1, memberIds: [M1], subtasks: [] }), "Unauthorized");

    expect(tasksIn(tables)).toHaveLength(1);
  });

  it("rejects a caller who is not a member of the target workspace", async () => {
    const { tables } = setup();

    await expectFailure(createTaskWithSubtasks({ title: "X", workspaceId: WS2, memberIds: [M1], subtasks: [] }), `not a member of workspace ${WS2}`);

    expect(tasksIn(tables)).toHaveLength(1);
  });

  it("rejects a memberId belonging to another workspace", async () => {
    const { tables } = setup();

    await expectFailure(createTaskWithSubtasks({
        title: "X",
        workspaceId: WS1,
        memberIds: [M1, M_OUTSIDER],
        subtasks: [],
      }), `members not in workspace ${WS1}: ${M_OUTSIDER}`);

    expect(tasksIn(tables)).toHaveLength(1);
  });

  it("assigns the member with the next sort key via the assign_task_member rpc", async () => {
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

    expect(rpcSpy).toHaveBeenCalledWith(
      "assign_task_member",
      expect.objectContaining({ p_member_id: M1 })
    );
    const newAssignment = assignmentsIn(fake.tables).find(
      (a) => a.member_id === M1 && a.member_sort_key === 6000
    );
    expect(newAssignment).toBeDefined();
  });
});

// ─── updateTask ──────────────────────────────────────────────────────────────

describe("updateTask", () => {
  it("updates task fields and revalidates", async () => {
    const { tables } = setup();

    await updateTask({ taskId: T1, title: "Updated title", dueAt: "2026-05-01", memberIds: [M1] });

    expect(tasksIn(tables)[0]).toMatchObject({
      title: "Updated title",
      description: null,
      due_at: "2026-05-01T00:00:00Z",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("adds new assignees and removes dropped ones", async () => {
    const { tables } = setup();

    await updateTask({ taskId: T1, title: "T", memberIds: [M2] });

    const forTask = assignmentsIn(tables).filter((a) => a.task_id === T1);
    expect(forTask).toHaveLength(1);
    expect(forTask[0]).toMatchObject({ member_id: M2, member_sort_key: 1000 });
  });

  it("rejects an unauthenticated caller", async () => {
    const { tables } = setup({ user: null });

    await expectFailure(updateTask({ taskId: T1, title: "Hacked", memberIds: [M1] }), "Unauthorized");

    expect(tasksIn(tables)[0].title).toBe("Task 1");
  });

  it("rejects a caller who is not assigned to the task", async () => {
    const tables = seed();
    tables.tasks.push({ id: T_OTHER, workspace_id: WS1, title: "Theirs", completed_at: null });
    tables.task_assignments.push({ task_id: T_OTHER, member_id: M2, member_sort_key: 1000 });
    setup({ tables });

    await expectFailure(updateTask({ taskId: T_OTHER, title: "Hacked", memberIds: [M1] }), "Forbidden");

    expect(tasksIn(tables).find((t) => t.id === T_OTHER)?.title).toBe("Theirs");
  });

  it("rejects reassignment to a member of another workspace", async () => {
    const { tables } = setup();

    await expectFailure(updateTask({ taskId: T1, title: "T", memberIds: [M_OUTSIDER] }), `members not in workspace ${WS1}: ${M_OUTSIDER}`);

    expect(assignmentsIn(tables)).toHaveLength(1);
    expect(assignmentsIn(tables)[0].member_id).toBe(M1);
  });

  // ─── moving to another workspace ───────────────────────────────────────────

  /** M1_WS2 is the signed-in user's own member row in WS2, which is where a move can go. */
  function seedForMove(): Tables {
    const tables = seed();
    tables.workspace_members.push({
      id: M1_WS2,
      workspace_id: WS2,
      auth_user_id: "auth-user-1",
      display_name: "Alice at work",
    });
    tables.tasks.push({ id: S1, workspace_id: WS1, parent_task_id: T1, completed_at: null, title: "Sub" });
    tables.task_assignments.push({ task_id: S1, member_id: M1, member_sort_key: 2000 });
    return tables;
  }

  it("moves the task and its subtasks, replacing every assignment", async () => {
    const tables = seedForMove();
    setup({ tables });

    const result = await updateTask({
      taskId: T1,
      title: "Moved",
      memberIds: [M1_WS2],
      workspaceId: WS2,
    });

    expect(result).toEqual({ ok: true });
    expect(tasksIn(tables).find((t) => t.id === T1)).toMatchObject({ workspace_id: WS2, title: "Moved" });
    expect(tasksIn(tables).find((t) => t.id === S1)?.workspace_id).toBe(WS2);
    // Old WS1 assignments are gone; parent and subtask are both assigned to the WS2 member.
    expect(assignmentsIn(tables).filter((a) => a.member_id === M1)).toHaveLength(0);
    expect(assignmentsIn(tables).filter((a) => a.member_id === M1_WS2).map((a) => a.task_id).sort()).toEqual(
      [T1, S1].sort()
    );
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("rejects moving a subtask on its own", async () => {
    const tables = seedForMove();
    setup({ tables });

    await expectFailure(
      updateTask({ taskId: S1, title: "Sub", memberIds: [M1_WS2], workspaceId: WS2 }),
      "subtask moves with its parent"
    );

    expect(tasksIn(tables).find((t) => t.id === S1)?.workspace_id).toBe(WS1);
  });

  it("rejects a move into a workspace the caller does not belong to", async () => {
    const tables = seedForMove();
    // The caller's own WS2 row is what authorizes the move; without it WS2 is someone else's.
    tables.workspace_members = tables.workspace_members.filter((m) => (m as Row).id !== M1_WS2);
    tables.workspace_members.push({
      id: M1_WS2,
      workspace_id: WS2,
      auth_user_id: "auth-user-9",
      display_name: "Not you",
    });
    setup({ tables });

    await expectFailure(
      updateTask({ taskId: T1, title: "T", memberIds: [M1_WS2], workspaceId: WS2 }),
      `Forbidden`
    );

    expect(tasksIn(tables).find((t) => t.id === T1)?.workspace_id).toBe(WS1);
  });

  it("rejects a move that assigns members outside the destination workspace", async () => {
    const tables = seedForMove();
    setup({ tables });

    await expectFailure(
      updateTask({ taskId: T1, title: "T", memberIds: [M1], workspaceId: WS2 }),
      `members not in workspace ${WS2}: ${M1}`
    );

    expect(tasksIn(tables).find((t) => t.id === T1)?.workspace_id).toBe(WS1);
    expect(assignmentsIn(tables).filter((a) => a.task_id === T1)).toHaveLength(1);
  });

  // The modal sends the task's workspace on every save, so the no-move case must stay on the
  // diff-based assignment path rather than tearing every assignment down and rebuilding it.
  it("treats the task's own workspace id as a plain edit", async () => {
    const tables = seedForMove();
    setup({ tables });

    await updateTask({ taskId: T1, title: "Edited", memberIds: [M1, M2], workspaceId: WS1 });

    expect(tasksIn(tables).find((t) => t.id === T1)).toMatchObject({ workspace_id: WS1, title: "Edited" });
    // M1's existing row kept its sort key — a rebuild would have reassigned it.
    const m1Row = assignmentsIn(tables).find((a) => a.task_id === T1 && a.member_id === M1);
    expect(m1Row?.member_sort_key).toBe(1000);
    expect(assignmentsIn(tables).filter((a) => a.task_id === T1)).toHaveLength(2);
  });
});

// ─── reorderTask ─────────────────────────────────────────────────────────────

describe("reorderTask", () => {
  const keyOf = (tables: Tables) =>
    assignmentsIn(tables).find((a) => a.task_id === T1)?.member_sort_key;

  it("computes midpoint key between prev and next", async () => {
    const { tables } = setup();

    await reorderTask({ taskId: T1, memberId: M1, prevKey: 1000, nextKey: 3000 });

    expect(keyOf(tables)).toBe(2000);
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("uses prevKey + 1000 when dropped at end", async () => {
    const { tables } = setup();

    await reorderTask({ taskId: T1, memberId: M1, prevKey: 5000, nextKey: null });

    expect(keyOf(tables)).toBe(6000);
  });

  it("uses nextKey - 1000 when dropped at start", async () => {
    const { tables } = setup();

    await reorderTask({ taskId: T1, memberId: M1, prevKey: null, nextKey: 3000 });

    expect(keyOf(tables)).toBe(2000);
  });

  it("rejects an unauthenticated caller", async () => {
    const { tables } = setup({ user: null });

    await expectFailure(reorderTask({ taskId: T1, memberId: M1, prevKey: 1000, nextKey: 3000 }), "Unauthorized");

    expect(keyOf(tables)).toBe(1000);
  });

  it("rejects reordering another member's list", async () => {
    const tables = seed();
    tables.task_assignments.push({ task_id: T1, member_id: M2, member_sort_key: 5000 });
    setup({ tables });

    await expectFailure(reorderTask({ taskId: T1, memberId: M2, prevKey: 1000, nextKey: 3000 }), `member ${M2} does not belong to the current user`);

    expect(assignmentsIn(tables).find((a) => a.member_id === M2)?.member_sort_key).toBe(5000);
  });

  it("rejects a caller who is not assigned to the task", async () => {
    const tables = seed();
    tables.tasks.push({ id: T_OTHER, workspace_id: WS1, completed_at: null });
    tables.task_assignments.push({ task_id: T_OTHER, member_id: M2, member_sort_key: 1000 });
    setup({ tables });

    await expectFailure(reorderTask({ taskId: T_OTHER, memberId: M1, prevKey: 1000, nextKey: 3000 }), "Forbidden");
  });
});

// ─── getTaskUpdates ──────────────────────────────────────────────────────

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

// ─── addTaskUpdate ───────────────────────────────────────────────────────────

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

// ─── addSubtask ──────────────────────────────────────────────────────────

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

// ─── input validation ────────────────────────────────────────────────────────

describe("input validation", () => {
  it("rejects a malformed task id before touching the database", async () => {
    const { tables } = setup();

    await expectFailure(completeTask("not-a-uuid"), "Expected a UUID");

    expect(tasksIn(tables)[0].completed_at).toBeNull();
  });

  it("rejects an oversized title", async () => {
    const { tables } = setup();

    await expectFailure(createTaskWithSubtasks({
        title: "x".repeat(201),
        workspaceId: WS1,
        memberIds: [M1],
        subtasks: [],
      }), "Title must be 200 characters or fewer");

    expect(tasksIn(tables)).toHaveLength(1);
  });

  it("rejects a blank title", async () => {
    setup();

    await expectFailure(createTaskWithSubtasks({ title: "   ", workspaceId: WS1, memberIds: [M1], subtasks: [] }), "Title is required");
  });

  it("trims the title before storing it", async () => {
    const { tables } = setup();

    await createTaskWithSubtasks({
      title: "  Padded  ",
      workspaceId: WS1,
      memberIds: [M1],
      subtasks: [],
    });

    expect(tasksIn(tables).some((t) => t.title === "Padded")).toBe(true);
  });

  it("rejects an oversized description", async () => {
    setup();

    await expectFailure(createTaskWithSubtasks({
        title: "Fine",
        description: "x".repeat(2001),
        workspaceId: WS1,
        memberIds: [M1],
        subtasks: [],
      }), "Description must be 2000 characters or fewer");
  });

  it("rejects a due date that is not YYYY-MM-DD", async () => {
    setup();

    await expectFailure(createTaskWithSubtasks({
        title: "Fine",
        dueAt: "15/06/2026",
        workspaceId: WS1,
        memberIds: [M1],
        subtasks: [],
      }), "Due date must be in YYYY-MM-DD format");
  });

  it("rejects more than 50 subtasks", async () => {
    setup();

    await expectFailure(createTaskWithSubtasks({
        title: "Fine",
        workspaceId: WS1,
        memberIds: [M1],
        subtasks: Array.from({ length: 51 }, (_, i) => ({ title: `Step ${i}` })),
      }), "A task cannot have more than 50 subtasks");
  });

  it("rejects an update that would leave the task with no assignees", async () => {
    const { tables } = setup();

    await expectFailure(updateTask({ taskId: T1, title: "T", memberIds: [] }), "Assign the task to at least one person");

    expect(assignmentsIn(tables)).toHaveLength(1);
  });

  it("rejects a reorder whose keys are out of order", async () => {
    const { tables } = setup();

    await expectFailure(reorderTask({ taskId: T1, memberId: M1, prevKey: 3000, nextKey: 1000 }), "prevKey must be less than nextKey");

    expect(assignmentsIn(tables)[0].member_sort_key).toBe(1000);
  });
});

// ─── parent/subtask completion rule ──────────────────────────────────────────

describe("completeTask — parent and subtasks complete together", () => {
  function seedFamily() {
    const tables = seed();
    tables.tasks.push(
      { id: P1, workspace_id: WS1, parent_task_id: null, completed_at: null, title: "Parent" },
      { id: S1, workspace_id: WS1, parent_task_id: P1, completed_at: null, title: "Sub 1" },
      { id: S2, workspace_id: WS1, parent_task_id: P1, completed_at: null, title: "Sub 2" }
    );
    tables.task_assignments.push(
      { task_id: P1, member_id: M1, member_sort_key: 2000 },
      { task_id: S1, member_id: M1, member_sort_key: 3000 },
      { task_id: S2, member_id: M1, member_sort_key: 4000 }
    );
    return tables;
  }

  it("completing a parent completes its open subtasks", async () => {
    const tables = seedFamily();
    setup({ tables });

    await completeTask(P1);

    const byId = (id: string) => tasksIn(tables).find((t) => t.id === id);
    expect(byId(P1)?.completed_at).toEqual(expect.any(String));
    expect(byId(S1)?.completed_at).toEqual(expect.any(String));
    expect(byId(S2)?.completed_at).toEqual(expect.any(String));
  });

  it("leaves an already-completed subtask's timestamp untouched", async () => {
    const tables = seedFamily();
    const earlier = "2026-01-01T00:00:00Z";
    tasksIn(tables).find((t) => t.id === S1)!.completed_at = earlier;
    setup({ tables });

    await completeTask(P1);

    expect(tasksIn(tables).find((t) => t.id === S1)?.completed_at).toBe(earlier);
  });

  it("completing the last open subtask still completes the parent", async () => {
    const tables = seedFamily();
    tasksIn(tables).find((t) => t.id === S1)!.completed_at = "2026-01-01T00:00:00Z";
    setup({ tables });

    await completeTask(S2);

    expect(tasksIn(tables).find((t) => t.id === P1)?.completed_at).toEqual(expect.any(String));
  });

  it("does not complete a task that is not this task's subtask", async () => {
    const tables = seedFamily();
    tables.tasks.push({ id: T_OTHER, workspace_id: WS1, parent_task_id: null, completed_at: null });
    tables.task_assignments.push({ task_id: T_OTHER, member_id: M1, member_sort_key: 5000 });
    setup({ tables });

    await completeTask(P1);

    expect(tasksIn(tables).find((t) => t.id === T_OTHER)?.completed_at).toBeNull();
  });
});

// ─── reopening ───────────────────────────────────────────────────────────────

describe("reopenTask", () => {
  const DONE = "2026-01-01T00:00:00Z";

  function seedCompletedFamily() {
    const tables = seed();
    tables.tasks.push(
      { id: P1, workspace_id: WS1, parent_task_id: null, completed_at: DONE, title: "Parent" },
      { id: S1, workspace_id: WS1, parent_task_id: P1, completed_at: DONE, title: "Sub 1" }
    );
    tables.task_assignments.push(
      { task_id: P1, member_id: M1, member_sort_key: 2000 },
      { task_id: S1, member_id: M1, member_sort_key: 3000 }
    );
    return tables;
  }

  it("clears the completion timestamp", async () => {
    const tables = seedCompletedFamily();
    setup({ tables });

    const result = await reopenTask(P1);

    expect(result.ok).toBe(true);
    expect(tasksIn(tables).find((t) => t.id === P1)?.completed_at).toBeNull();
  });

  it("leaves the subtasks of a reopened parent completed", async () => {
    const tables = seedCompletedFamily();
    setup({ tables });

    await reopenTask(P1);

    expect(tasksIn(tables).find((t) => t.id === S1)?.completed_at).toBe(DONE);
  });

  it("reopening a subtask reopens its parent", async () => {
    // The reverse of completeTask's cascade: a parent cannot stay complete while a subtask is open.
    const tables = seedCompletedFamily();
    setup({ tables });

    await reopenTask(S1);

    expect(tasksIn(tables).find((t) => t.id === S1)?.completed_at).toBeNull();
    expect(tasksIn(tables).find((t) => t.id === P1)?.completed_at).toBeNull();
  });

  it("rejects a user who is not assigned to the task", async () => {
    const tables = seedCompletedFamily();
    setup({ tables, user: { id: "auth-user-3" } });

    const result = await reopenTask(P1);

    expect(result.ok).toBe(false);
    expect(tasksIn(tables).find((t) => t.id === P1)?.completed_at).toBe(DONE);
  });

  it("rejects a malformed id before touching the database", async () => {
    const { tables } = setup();

    await expectFailure(reopenTask("not-a-uuid"), "Expected a UUID");

    expect(tasksIn(tables)[0].completed_at).toBeNull();
  });
});

describe("addSubtask — new work reopens a finished task", () => {
  it("clears the parent's completion when a subtask is added to it", async () => {
    const tables = seed();
    tasksIn(tables).find((t) => t.id === T1)!.completed_at = "2026-01-01T00:00:00Z";
    setup({ tables });

    const result = await addSubtask({ parentTaskId: T1, title: "One more thing" });

    expect(result.ok).toBe(true);
    expect(tasksIn(tables).find((t) => t.id === T1)?.completed_at).toBeNull();
  });

  it("leaves an open parent alone", async () => {
    const tables = seed();
    setup({ tables });

    await addSubtask({ parentTaskId: T1, title: "One more thing" });

    expect(tasksIn(tables).find((t) => t.id === T1)?.completed_at).toBeNull();
  });
});
