jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { completeTask, deleteTask, createTask, createTaskWithSubtasks } from "./actions";

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

// Helper: builds the mock chain for the sort-key lookup query
function makeSortKeyMock(lastKey: number | null) {
  const single = jest.fn().mockResolvedValue(
    lastKey === null
      ? { data: null, error: { code: "PGRST116" } }
      : { data: { member_sort_key: lastKey }, error: null }
  );
  const limit = jest.fn().mockReturnValue({ single });
  const order = jest.fn().mockReturnValue({ limit });
  const eq = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ eq });
  return select;
}

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
    const single = jest.fn().mockResolvedValue({ data: { id: "parent-id" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });

    const skSingle1 = jest.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const skLimit1 = jest.fn().mockReturnValue({ single: skSingle1 });
    const skOrder1 = jest.fn().mockReturnValue({ limit: skLimit1 });
    const skEq1 = jest.fn().mockReturnValue({ order: skOrder1 });
    const skSelect1 = jest.fn().mockReturnValue({ eq: skEq1 });
    const insertAsgn1 = jest.fn().mockResolvedValue({ error: null });

    const subSingle = jest.fn().mockResolvedValue({ data: { id: "sub-id" }, error: null });
    const subSelect = jest.fn().mockReturnValue({ single: subSingle });
    const insertSubtask = jest.fn().mockReturnValue({ select: subSelect });

    const skSingle2 = jest.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const skLimit2 = jest.fn().mockReturnValue({ single: skSingle2 });
    const skOrder2 = jest.fn().mockReturnValue({ limit: skLimit2 });
    const skEq2 = jest.fn().mockReturnValue({ order: skOrder2 });
    const skSelect2 = jest.fn().mockReturnValue({ eq: skEq2 });
    const insertAsgn2 = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })
      .mockReturnValueOnce({ select: skSelect1 })
      .mockReturnValueOnce({ insert: insertAsgn1 })
      .mockReturnValueOnce({ insert: insertSubtask })
      .mockReturnValueOnce({ select: skSelect2 })
      .mockReturnValueOnce({ insert: insertAsgn2 });

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
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
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

// ─── createTask: additional coverage ────────────────────────────────────────

describe("createTask — due date encoding", () => {
  it("appends :00Z to datetime-local value when dueAt is provided", async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: "t-1" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });
    const insertAsgn = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })
      .mockReturnValueOnce({ select: makeSortKeyMock(null) })
      .mockReturnValueOnce({ insert: insertAsgn });

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    await createTask({ title: "Meeting", dueAt: "2026-06-15T09:30", workspaceId: "ws-1", memberIds: ["m-1"] });

    expect(insertTask).toHaveBeenCalledWith(
      expect.objectContaining({ due_at: "2026-06-15T09:30:00Z" })
    );
  });

  it("stores null when dueAt is omitted", async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: "t-1" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });
    const insertAsgn = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })
      .mockReturnValueOnce({ select: makeSortKeyMock(null) })
      .mockReturnValueOnce({ insert: insertAsgn });

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    await createTask({ title: "No deadline", workspaceId: "ws-1", memberIds: ["m-1"] });

    expect(insertTask).toHaveBeenCalledWith(
      expect.objectContaining({ due_at: null })
    );
  });
});

describe("createTask — sort key chaining", () => {
  it("uses last sort key + 1000 when a prior assignment exists", async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: "t-2" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });
    const insertAsgn = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })
      .mockReturnValueOnce({ select: makeSortKeyMock(3000) })
      .mockReturnValueOnce({ insert: insertAsgn });

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    await createTask({ title: "Follow-up", workspaceId: "ws-1", memberIds: ["m-1"] });

    expect(insertAsgn).toHaveBeenCalledWith(
      expect.objectContaining({ member_sort_key: 4000 })
    );
  });

  it("assigns each member their own sort key independently", async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: "t-3" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });
    const insertAsgn1 = jest.fn().mockResolvedValue({ error: null });
    const insertAsgn2 = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })
      .mockReturnValueOnce({ select: makeSortKeyMock(null) })   // m-1: no prior
      .mockReturnValueOnce({ insert: insertAsgn1 })
      .mockReturnValueOnce({ select: makeSortKeyMock(2000) })  // m-2: prior = 2000
      .mockReturnValueOnce({ insert: insertAsgn2 });

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    await createTask({ title: "Shared", workspaceId: "ws-1", memberIds: ["m-1", "m-2"] });

    expect(insertAsgn1).toHaveBeenCalledWith(expect.objectContaining({ member_id: "m-1", member_sort_key: 1000 }));
    expect(insertAsgn2).toHaveBeenCalledWith(expect.objectContaining({ member_id: "m-2", member_sort_key: 3000 }));
  });
});

describe("createTask — error handling", () => {
  it("throws when task insert returns an error", async () => {
    const single = jest.fn().mockResolvedValue({ data: null, error: { message: "DB failure" } });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });

    (createClient as jest.Mock).mockResolvedValue({ from: jest.fn().mockReturnValue({ insert: insertTask }) });

    await expect(
      createTask({ title: "Broken", workspaceId: "ws-1", memberIds: ["m-1"] })
    ).rejects.toThrow("DB failure");
  });
});

// ─── createTaskWithSubtasks: additional coverage ─────────────────────────────

describe("createTaskWithSubtasks — description", () => {
  it("passes description to task insert when provided", async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: "p-1" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });
    const insertAsgn = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })
      .mockReturnValueOnce({ select: makeSortKeyMock(null) })
      .mockReturnValueOnce({ insert: insertAsgn });

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    await createTaskWithSubtasks({
      title: "Plan event",
      description: "Arrange catering and venue",
      workspaceId: "ws-1",
      memberIds: ["m-1"],
      subtasks: [],
    });

    expect(insertTask).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Arrange catering and venue" })
    );
  });

  it("stores null description when omitted", async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: "p-2" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });
    const insertAsgn = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })
      .mockReturnValueOnce({ select: makeSortKeyMock(null) })
      .mockReturnValueOnce({ insert: insertAsgn });

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    await createTaskWithSubtasks({
      title: "Quick task",
      workspaceId: "ws-1",
      memberIds: ["m-1"],
      subtasks: [],
    });

    expect(insertTask).toHaveBeenCalledWith(
      expect.objectContaining({ description: null })
    );
  });
});

describe("createTaskWithSubtasks — deduplicates memberIds", () => {
  it("creates only one assignment per member even if memberIds has duplicates", async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: "p-3" }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insertTask = jest.fn().mockReturnValue({ select });
    const insertAsgn = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertTask })
      .mockReturnValueOnce({ select: makeSortKeyMock(null) })
      .mockReturnValueOnce({ insert: insertAsgn });

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    await createTaskWithSubtasks({
      title: "Dedup test",
      workspaceId: "ws-1",
      memberIds: ["m-1", "m-1", "m-1"],
      subtasks: [],
    });

    // Only one assignment insert for the deduplicated m-1
    expect(insertAsgn).toHaveBeenCalledTimes(1);
  });
});

describe("createTaskWithSubtasks — subtask with no due date", () => {
  it("stores null for subtask due_at when dueAt is omitted", async () => {
    const parentSingle = jest.fn().mockResolvedValue({ data: { id: "p-4" }, error: null });
    const parentSelect = jest.fn().mockReturnValue({ single: parentSingle });
    const insertParent = jest.fn().mockReturnValue({ select: parentSelect });

    const subSingle = jest.fn().mockResolvedValue({ data: { id: "sub-1" }, error: null });
    const subSelect = jest.fn().mockReturnValue({ single: subSingle });
    const insertSub = jest.fn().mockReturnValue({ select: subSelect });

    const insertAsgn1 = jest.fn().mockResolvedValue({ error: null });
    const insertAsgn2 = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertParent })
      .mockReturnValueOnce({ select: makeSortKeyMock(null) })
      .mockReturnValueOnce({ insert: insertAsgn1 })
      .mockReturnValueOnce({ insert: insertSub })
      .mockReturnValueOnce({ select: makeSortKeyMock(null) })
      .mockReturnValueOnce({ insert: insertAsgn2 });

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    await createTaskWithSubtasks({
      title: "Parent",
      workspaceId: "ws-1",
      memberIds: ["m-1"],
      subtasks: [{ title: "No-date subtask" }],
    });

    expect(insertSub).toHaveBeenCalledWith(
      expect.objectContaining({ due_at: null, title: "No-date subtask" })
    );
  });
});

describe("createTaskWithSubtasks — multiple subtasks all succeed", () => {
  it("returns subtaskErrors: 0 and calls revalidatePath once when all subtasks succeed", async () => {
    const parentSingle = jest.fn().mockResolvedValue({ data: { id: "p-5" }, error: null });
    const parentSelect = jest.fn().mockReturnValue({ single: parentSingle });
    const insertParent = jest.fn().mockReturnValue({ select: parentSelect });

    function makeSubMock(id: string) {
      const s = jest.fn().mockResolvedValue({ data: { id }, error: null });
      const sel = jest.fn().mockReturnValue({ single: s });
      return jest.fn().mockReturnValue({ select: sel });
    }

    const insertAsgn = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: insertParent })
      .mockReturnValueOnce({ select: makeSortKeyMock(null) })  // parent asgn sort key
      .mockReturnValueOnce({ insert: insertAsgn })             // parent asgn insert
      .mockReturnValueOnce({ insert: makeSubMock("sub-a") })
      .mockReturnValueOnce({ select: makeSortKeyMock(null) })
      .mockReturnValueOnce({ insert: insertAsgn })
      .mockReturnValueOnce({ insert: makeSubMock("sub-b") })
      .mockReturnValueOnce({ select: makeSortKeyMock(null) })
      .mockReturnValueOnce({ insert: insertAsgn });

    (createClient as jest.Mock).mockResolvedValue({ from: mockFrom });

    const result = await createTaskWithSubtasks({
      title: "Multi-subtask parent",
      workspaceId: "ws-1",
      memberIds: ["m-1"],
      subtasks: [
        { title: "Step 1", dueAt: "2026-04-01" },
        { title: "Step 2" },
      ],
    });

    expect(result).toEqual({ subtaskErrors: 0 });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });
});

describe("createTaskWithSubtasks — parent insert failure", () => {
  it("throws and does not revalidate when parent task insert fails", async () => {
    const single = jest.fn().mockResolvedValue({ data: null, error: { message: "constraint violation" } });
    const select = jest.fn().mockReturnValue({ single });
    const insertParent = jest.fn().mockReturnValue({ select });

    (createClient as jest.Mock).mockResolvedValue({ from: jest.fn().mockReturnValue({ insert: insertParent }) });

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
});
