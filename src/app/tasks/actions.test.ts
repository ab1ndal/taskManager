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
