import { createFakeSupabase, type Row } from "./supabase-fake";

describe("createFakeSupabase — rpc", () => {
  it("assign_task_member inserts with max(member_sort_key) + 1000 for a member with existing rows", async () => {
    const fake = createFakeSupabase({
      tables: {
        task_assignments: [
          { task_id: "t1", member_id: "m1", member_sort_key: 3000 },
          { task_id: "t2", member_id: "m1", member_sort_key: 1000 },
          { task_id: "t3", member_id: "m2", member_sort_key: 9000 },
        ],
      },
    });

    const { data, error } = await fake.rpc("assign_task_member", {
      p_task_id: "t4",
      p_member_id: "m1",
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ task_id: "t4", member_id: "m1", member_sort_key: 4000 });
    expect(fake.tables.task_assignments).toContainEqual({
      task_id: "t4",
      member_id: "m1",
      member_sort_key: 4000,
    });
  });

  it("assign_task_member inserts with sort key 1000 for a member with no existing rows", async () => {
    const fake = createFakeSupabase({ tables: { task_assignments: [] } });

    const { data, error } = await fake.rpc("assign_task_member", {
      p_task_id: "t1",
      p_member_id: "m-new",
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ task_id: "t1", member_id: "m-new", member_sort_key: 1000 });
  });

  it("move_task_workspace re-homes the root task's column to the destination workspace, leaving a subtask's null", async () => {
    const fake = createFakeSupabase({
      tables: {
        workspace_members: [{ id: "m1", workspace_id: "ws2", auth_user_id: "auth-user-1", display_name: "Alice" }],
        tasks: [
          { id: "root", workspace_id: "ws1", parent_task_id: null, completed_at: null, title: "Root" },
          { id: "sub", workspace_id: null, parent_task_id: "root", completed_at: null, title: "Sub" },
        ],
        task_assignments: [],
        board_columns: [
          // Terminal column sits earlier in position than the non-terminal one, so a lookup that
          // relied on position instead of is_done would pick the wrong column.
          { id: "ws2-done", workspace_id: "ws2", name: "Done", color: "tab20-green", position: 500, is_done: true },
          { id: "ws2-first", workspace_id: "ws2", name: "Not Started", color: "tab20-grey", position: 1000, is_done: false },
        ],
      },
    });

    const { error } = await fake.rpc("move_task_workspace", {
      p_task_id: "root",
      p_workspace_id: "ws2",
      p_member_ids: ["m1"],
    });

    expect(error).toBeNull();
    const tasks = fake.tables.tasks as Row[];
    expect(tasks.find((t) => t.id === "root")).toMatchObject({ workspace_id: "ws2", board_column_id: "ws2-first" });
    expect(tasks.find((t) => t.id === "sub")?.board_column_id ?? null).toBeNull();
  });

  it("move_task_workspace fails when the destination workspace has no non-terminal column", async () => {
    const fake = createFakeSupabase({
      tables: {
        workspace_members: [{ id: "m1", workspace_id: "ws2", auth_user_id: "auth-user-1", display_name: "Alice" }],
        tasks: [{ id: "root", workspace_id: "ws1", parent_task_id: null, completed_at: null, title: "Root" }],
        task_assignments: [],
        board_columns: [
          { id: "ws2-done", workspace_id: "ws2", name: "Done", color: "tab20-green", position: 500, is_done: true },
        ],
      },
    });

    const { data, error } = await fake.rpc("move_task_workspace", {
      p_task_id: "root",
      p_workspace_id: "ws2",
      p_member_ids: ["m1"],
    });

    expect(data).toBeNull();
    expect(error).toEqual({ message: expect.stringContaining("has no non-terminal board column") });
    expect((fake.tables.tasks as Row[]).find((t) => t.id === "root")?.workspace_id).toBe("ws1");
  });

  it("returns an error for an unknown rpc name", async () => {
    const fake = createFakeSupabase({ tables: {} });

    const { data, error } = await fake.rpc("not_a_real_function", {});

    expect(data).toBeNull();
    expect(error).toEqual({ message: expect.stringContaining("not_a_real_function") });
  });
});
