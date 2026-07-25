jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { createFakeSupabase, type FailureHook, type Row, type Tables } from "@/test/supabase-fake";
import { completeTask, deleteTask, createTaskWithSubtasks, updateTask, reorderTask } from "./actions";

beforeEach(() => jest.clearAllMocks());

/**
 * Default fixture: two members of ws-1 (m-1 is the signed-in user, m-2 a colleague), one outsider
 * in ws-2, and one task t-1 assigned to m-1.
 */
function seed(): Tables {
  return {
    workspace_members: [
      { id: "m-1", workspace_id: "ws-1", auth_user_id: "auth-user-1" },
      { id: "m-2", workspace_id: "ws-1", auth_user_id: "auth-user-2" },
      { id: "m-outsider", workspace_id: "ws-2", auth_user_id: "auth-user-3" },
    ],
    tasks: [
      { id: "t-1", workspace_id: "ws-1", parent_task_id: null, completed_at: null, title: "Task 1" },
    ],
    task_assignments: [{ task_id: "t-1", member_id: "m-1", member_sort_key: 1000 }],
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

const tasksIn = (t: Tables) => t.tasks as Row[];
const assignmentsIn = (t: Tables) => t.task_assignments as Row[];

// ─── completeTask ────────────────────────────────────────────────────────────

describe("completeTask", () => {
  it("marks task complete and revalidates", async () => {
    const { tables } = setup();

    await completeTask("t-1");

    expect(tasksIn(tables)[0].completed_at).toEqual(expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("auto-completes parent when all siblings are done", async () => {
    const tables = seed();
    tables.tasks.push(
      { id: "p-1", workspace_id: "ws-1", parent_task_id: null, completed_at: null },
      { id: "s-1", workspace_id: "ws-1", parent_task_id: "p-1", completed_at: null },
      { id: "s-2", workspace_id: "ws-1", parent_task_id: "p-1", completed_at: "2026-01-01T00:00:00Z" }
    );
    tables.task_assignments.push({ task_id: "s-1", member_id: "m-1", member_sort_key: 2000 });
    setup({ tables });

    await completeTask("s-1");

    const parent = tasksIn(tables).find((t) => t.id === "p-1");
    expect(parent?.completed_at).toEqual(expect.any(String));
  });

  it("does not auto-complete parent when siblings remain", async () => {
    const tables = seed();
    tables.tasks.push(
      { id: "p-1", workspace_id: "ws-1", parent_task_id: null, completed_at: null },
      { id: "s-1", workspace_id: "ws-1", parent_task_id: "p-1", completed_at: null },
      { id: "s-2", workspace_id: "ws-1", parent_task_id: "p-1", completed_at: null }
    );
    tables.task_assignments.push({ task_id: "s-1", member_id: "m-1", member_sort_key: 2000 });
    setup({ tables });

    await completeTask("s-1");

    const parent = tasksIn(tables).find((t) => t.id === "p-1");
    expect(parent?.completed_at).toBeNull();
  });

  it("rejects an unauthenticated caller", async () => {
    const { tables } = setup({ user: null });

    await expect(completeTask("t-1")).rejects.toThrow("Unauthorized");

    expect(tasksIn(tables)[0].completed_at).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not assigned to the task", async () => {
    const tables = seed();
    tables.tasks.push({ id: "t-other", workspace_id: "ws-1", parent_task_id: null, completed_at: null });
    tables.task_assignments.push({ task_id: "t-other", member_id: "m-2", member_sort_key: 1000 });
    setup({ tables });

    await expect(completeTask("t-other")).rejects.toThrow("Forbidden");

    expect(tasksIn(tables).find((t) => t.id === "t-other")?.completed_at).toBeNull();
  });
});

// ─── deleteTask ──────────────────────────────────────────────────────────────

describe("deleteTask", () => {
  it("deletes task and revalidates /tasks", async () => {
    const { tables } = setup();

    await deleteTask("t-1");

    expect(tasksIn(tables)).toHaveLength(0);
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("rejects an unauthenticated caller", async () => {
    const { tables } = setup({ user: null });

    await expect(deleteTask("t-1")).rejects.toThrow("Unauthorized");

    expect(tasksIn(tables)).toHaveLength(1);
  });

  it("rejects a caller who is not assigned to the task", async () => {
    const tables = seed();
    tables.tasks.push({ id: "t-other", workspace_id: "ws-1", parent_task_id: null, completed_at: null });
    tables.task_assignments.push({ task_id: "t-other", member_id: "m-2", member_sort_key: 1000 });
    setup({ tables });

    await expect(deleteTask("t-other")).rejects.toThrow("Forbidden");

    expect(tasksIn(tables).find((t) => t.id === "t-other")).toBeDefined();
  });
});

// ─── createTaskWithSubtasks ──────────────────────────────────────────────────

describe("createTaskWithSubtasks", () => {
  it("inserts parent task + assignment and returns subtaskErrors: 0 when no subtasks", async () => {
    const { tables } = setup();

    const result = await createTaskWithSubtasks({
      title: "Parent task",
      workspaceId: "ws-1",
      memberIds: ["m-1"],
      subtasks: [],
    });

    const parent = tasksIn(tables).find((t) => t.title === "Parent task");
    expect(parent).toMatchObject({ workspace_id: "ws-1", description: null, due_at: null });
    expect(assignmentsIn(tables)).toContainEqual(
      expect.objectContaining({ task_id: parent!.id, member_id: "m-1" })
    );
    expect(result).toEqual({ subtaskErrors: 0 });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("inserts subtasks with parent_task_id and converts bare date to UTC midnight", async () => {
    const { tables } = setup();

    const result = await createTaskWithSubtasks({
      title: "Parent",
      description: "Arrange catering and venue",
      workspaceId: "ws-1",
      memberIds: ["m-1"],
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
      expect.objectContaining({ task_id: subtask!.id, member_id: "m-1" })
    );
    expect(result).toEqual({ subtaskErrors: 0 });
  });

  it("stores the parent due date as UTC midnight and null when omitted", async () => {
    const { tables } = setup();

    await createTaskWithSubtasks({
      title: "Meeting",
      dueAt: "2026-06-15",
      workspaceId: "ws-1",
      memberIds: ["m-1"],
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
      workspaceId: "ws-1",
      memberIds: ["m-1", "m-2"],
      subtasks: [],
    });

    const shared = tasksIn(tables).find((t) => t.title === "Shared");
    const forShared = assignmentsIn(tables).filter((a) => a.task_id === shared!.id);

    expect(forShared).toContainEqual(
      expect.objectContaining({ member_id: "m-1", member_sort_key: 2000 })
    );
    expect(forShared).toContainEqual(
      expect.objectContaining({ member_id: "m-2", member_sort_key: 1000 })
    );
  });

  it("creates only one assignment per member when memberIds has duplicates", async () => {
    const { tables } = setup();

    await createTaskWithSubtasks({
      title: "Dedup test",
      workspaceId: "ws-1",
      memberIds: ["m-1", "m-1", "m-1"],
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
      workspaceId: "ws-1",
      memberIds: ["m-1"],
      subtasks: [{ title: "Bad subtask" }],
    });

    expect(result).toEqual({ subtaskErrors: 1 });
    expect(tasksIn(tables).find((t) => t.title === "Bad subtask")).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("throws and does not revalidate when the parent task insert fails", async () => {
    setup({
      failOn: (table, op) =>
        table === "tasks" && op === "insert" ? { message: "constraint violation" } : null,
    });

    await expect(
      createTaskWithSubtasks({
        title: "Failing parent",
        workspaceId: "ws-1",
        memberIds: ["m-1"],
        subtasks: [],
      })
    ).rejects.toThrow("constraint violation");

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    const { tables } = setup({ user: null });

    await expect(
      createTaskWithSubtasks({ title: "X", workspaceId: "ws-1", memberIds: ["m-1"], subtasks: [] })
    ).rejects.toThrow("Unauthorized");

    expect(tasksIn(tables)).toHaveLength(1);
  });

  it("rejects a caller who is not a member of the target workspace", async () => {
    const { tables } = setup();

    await expect(
      createTaskWithSubtasks({ title: "X", workspaceId: "ws-2", memberIds: [], subtasks: [] })
    ).rejects.toThrow("not a member of workspace ws-2");

    expect(tasksIn(tables)).toHaveLength(1);
  });

  it("rejects a memberId belonging to another workspace", async () => {
    const { tables } = setup();

    await expect(
      createTaskWithSubtasks({
        title: "X",
        workspaceId: "ws-1",
        memberIds: ["m-1", "m-outsider"],
        subtasks: [],
      })
    ).rejects.toThrow("members not in workspace ws-1: m-outsider");

    expect(tasksIn(tables)).toHaveLength(1);
  });
});

// ─── updateTask ──────────────────────────────────────────────────────────────

describe("updateTask", () => {
  it("updates task fields and revalidates", async () => {
    const { tables } = setup();

    await updateTask({ taskId: "t-1", title: "Updated title", dueAt: "2026-05-01", memberIds: ["m-1"] });

    expect(tasksIn(tables)[0]).toMatchObject({
      title: "Updated title",
      description: null,
      due_at: "2026-05-01T00:00:00Z",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("adds new assignees and removes dropped ones", async () => {
    const { tables } = setup();

    await updateTask({ taskId: "t-1", title: "T", memberIds: ["m-2"] });

    const forTask = assignmentsIn(tables).filter((a) => a.task_id === "t-1");
    expect(forTask).toHaveLength(1);
    expect(forTask[0]).toMatchObject({ member_id: "m-2", member_sort_key: 1000 });
  });

  it("rejects an unauthenticated caller", async () => {
    const { tables } = setup({ user: null });

    await expect(updateTask({ taskId: "t-1", title: "Hacked", memberIds: ["m-1"] })).rejects.toThrow(
      "Unauthorized"
    );

    expect(tasksIn(tables)[0].title).toBe("Task 1");
  });

  it("rejects a caller who is not assigned to the task", async () => {
    const tables = seed();
    tables.tasks.push({ id: "t-other", workspace_id: "ws-1", title: "Theirs", completed_at: null });
    tables.task_assignments.push({ task_id: "t-other", member_id: "m-2", member_sort_key: 1000 });
    setup({ tables });

    await expect(
      updateTask({ taskId: "t-other", title: "Hacked", memberIds: ["m-1"] })
    ).rejects.toThrow("Forbidden");

    expect(tasksIn(tables).find((t) => t.id === "t-other")?.title).toBe("Theirs");
  });

  it("rejects reassignment to a member of another workspace", async () => {
    const { tables } = setup();

    await expect(
      updateTask({ taskId: "t-1", title: "T", memberIds: ["m-outsider"] })
    ).rejects.toThrow("members not in workspace ws-1: m-outsider");

    expect(assignmentsIn(tables)).toHaveLength(1);
    expect(assignmentsIn(tables)[0].member_id).toBe("m-1");
  });
});

// ─── reorderTask ─────────────────────────────────────────────────────────────

describe("reorderTask", () => {
  const keyOf = (tables: Tables) =>
    assignmentsIn(tables).find((a) => a.task_id === "t-1")?.member_sort_key;

  it("computes midpoint key between prev and next", async () => {
    const { tables } = setup();

    await reorderTask({ taskId: "t-1", memberId: "m-1", prevKey: 1000, nextKey: 3000 });

    expect(keyOf(tables)).toBe(2000);
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("uses prevKey + 1000 when dropped at end", async () => {
    const { tables } = setup();

    await reorderTask({ taskId: "t-1", memberId: "m-1", prevKey: 5000, nextKey: null });

    expect(keyOf(tables)).toBe(6000);
  });

  it("uses nextKey - 1000 when dropped at start", async () => {
    const { tables } = setup();

    await reorderTask({ taskId: "t-1", memberId: "m-1", prevKey: null, nextKey: 3000 });

    expect(keyOf(tables)).toBe(2000);
  });

  it("rejects an unauthenticated caller", async () => {
    const { tables } = setup({ user: null });

    await expect(
      reorderTask({ taskId: "t-1", memberId: "m-1", prevKey: 1000, nextKey: 3000 })
    ).rejects.toThrow("Unauthorized");

    expect(keyOf(tables)).toBe(1000);
  });

  it("rejects reordering another member's list", async () => {
    const tables = seed();
    tables.task_assignments.push({ task_id: "t-1", member_id: "m-2", member_sort_key: 5000 });
    setup({ tables });

    await expect(
      reorderTask({ taskId: "t-1", memberId: "m-2", prevKey: 1000, nextKey: 3000 })
    ).rejects.toThrow("member m-2 does not belong to the current user");

    expect(assignmentsIn(tables).find((a) => a.member_id === "m-2")?.member_sort_key).toBe(5000);
  });

  it("rejects a caller who is not assigned to the task", async () => {
    const tables = seed();
    tables.tasks.push({ id: "t-other", workspace_id: "ws-1", completed_at: null });
    tables.task_assignments.push({ task_id: "t-other", member_id: "m-2", member_sort_key: 1000 });
    setup({ tables });

    await expect(
      reorderTask({ taskId: "t-other", memberId: "m-1", prevKey: 1000, nextKey: 3000 })
    ).rejects.toThrow("Forbidden");
  });
});
