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
