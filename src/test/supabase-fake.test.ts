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

  it("move_task_workspace treats a column with is_done omitted as non-terminal", async () => {
    // board_columns.is_done is boolean not null default false, so a fixture row that omits the
    // field must behave as non-terminal, same as one with is_done: false written out.
    const fake = createFakeSupabase({
      tables: {
        workspace_members: [{ id: "m1", workspace_id: "ws2", auth_user_id: "auth-user-1", display_name: "Alice" }],
        tasks: [{ id: "root", workspace_id: "ws1", parent_task_id: null, completed_at: null, title: "Root" }],
        task_assignments: [],
        board_columns: [
          { id: "ws2-done", workspace_id: "ws2", name: "Done", color: "tab20-green", position: 500, is_done: true },
          { id: "ws2-first", workspace_id: "ws2", name: "Not Started", color: "tab20-grey", position: 1000 },
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

describe("move_task_to_column", () => {
  const WS = "a0000000-0000-4000-8000-000000000001";
  const COL_A = "e0000000-0000-4000-8000-00000000000a";
  const COL_B = "e0000000-0000-4000-8000-00000000000b";
  const MEMBER = "b0000000-0000-4000-8000-000000000001";
  const OTHER_MEMBER = "b0000000-0000-4000-8000-000000000002";
  const TASK = "c0000000-0000-4000-8000-000000000001";

  function tables() {
    return {
      workspace_members: [
        { id: MEMBER, workspace_id: WS, auth_user_id: "auth-user-1" },
        { id: OTHER_MEMBER, workspace_id: WS, auth_user_id: "auth-user-2" },
      ],
      board_columns: [
        { id: COL_A, workspace_id: WS, name: "Not Started", position: 1000, is_done: false },
        { id: COL_B, workspace_id: WS, name: "In Progress", position: 2000, is_done: false },
      ],
      tasks: [{ id: TASK, workspace_id: WS, parent_task_id: null, board_column_id: COL_A }],
      task_assignments: [{ task_id: TASK, member_id: MEMBER, member_sort_key: 1000 }],
    };
  }

  it("writes the column and the midpoint sort key together", async () => {
    const t = tables();
    const fake = createFakeSupabase({ tables: t });

    const { error } = await fake.rpc("move_task_to_column", {
      p_task_id: TASK,
      p_column_id: COL_B,
      p_member_id: MEMBER,
      p_prev_key: 1000,
      p_next_key: 2000,
    });

    expect(error).toBeNull();
    expect((t.tasks as Row[])[0].board_column_id).toBe(COL_B);
    expect((t.task_assignments as Row[])[0].member_sort_key).toBe(1500);
  });

  it("changes only the column when the destination is empty", async () => {
    const t = tables();
    const fake = createFakeSupabase({ tables: t });

    await fake.rpc("move_task_to_column", {
      p_task_id: TASK,
      p_column_id: COL_B,
      p_member_id: MEMBER,
      p_prev_key: null,
      p_next_key: null,
    });

    expect((t.tasks as Row[])[0].board_column_id).toBe(COL_B);
    expect((t.task_assignments as Row[])[0].member_sort_key).toBe(1000);
  });

  it("refuses a column from another workspace", async () => {
    const t = tables();
    (t.board_columns as Row[]).push({
      id: "e0000000-0000-4000-8000-00000000000c",
      workspace_id: "a0000000-0000-4000-8000-000000000002",
      name: "Elsewhere",
      position: 1000,
      is_done: false,
    });
    const fake = createFakeSupabase({ tables: t });

    const { error } = await fake.rpc("move_task_to_column", {
      p_task_id: TASK,
      p_column_id: "e0000000-0000-4000-8000-00000000000c",
      p_member_id: MEMBER,
      p_prev_key: null,
      p_next_key: null,
    });

    expect(error?.message).toMatch(/not in workspace/);
    expect((t.tasks as Row[])[0].board_column_id).toBe(COL_A);
  });

  // Migration 020's review fix: the both-null branch used to return before task_assignments was
  // ever read, so the "not found" on that update was the only assignment check, and it never ran
  // for a drop into an empty column. A member who is in the workspace but not assigned to the task
  // must be refused here too, before board_column_id is written.
  it("refuses a member who is not assigned to the task, even dropping into an empty column", async () => {
    const t = tables();
    const fake = createFakeSupabase({ tables: t });

    const { error } = await fake.rpc("move_task_to_column", {
      p_task_id: TASK,
      p_column_id: COL_B,
      p_member_id: OTHER_MEMBER,
      p_prev_key: null,
      p_next_key: null,
    });

    expect(error?.message).toMatch(/is not assigned to task/);
    expect((t.tasks as Row[])[0].board_column_id).toBe(COL_A);
  });
});

describe("delete_board_column", () => {
  const WS = "a0000000-0000-4000-8000-000000000001";
  const COL_A = "e0000000-0000-4000-8000-00000000000a";
  const COL_B = "e0000000-0000-4000-8000-00000000000b";
  const T1 = "c0000000-0000-4000-8000-000000000001";
  const T2 = "c0000000-0000-4000-8000-000000000002";

  function tables(): { board_columns: Row[]; tasks: Row[] } {
    return {
      board_columns: [
        { id: COL_A, workspace_id: WS, name: "Blocked", position: 1000, is_done: false },
        { id: COL_B, workspace_id: WS, name: "In Progress", position: 2000, is_done: false },
      ],
      tasks: [
        { id: T1, workspace_id: WS, parent_task_id: null, board_column_id: COL_A },
        { id: T2, workspace_id: WS, parent_task_id: null, board_column_id: COL_A },
      ],
    };
  }

  it("applies each task's own destination and drops the column", async () => {
    const t = tables();
    const fake = createFakeSupabase({ tables: t });

    const { error } = await fake.rpc("delete_board_column", {
      p_column_id: COL_A,
      p_moves: [
        { task_id: T1, target_column_id: COL_B },
        { task_id: T2, target_column_id: COL_B },
      ],
    });

    expect(error).toBeNull();
    expect((t.tasks as Row[]).map((r) => r.board_column_id)).toEqual([COL_B, COL_B]);
    expect((t.board_columns as Row[]).map((r) => r.id)).toEqual([COL_B]);
  });

  it("refuses moves that do not cover every task in the column", async () => {
    const t = tables();
    const fake = createFakeSupabase({ tables: t });

    const { error } = await fake.rpc("delete_board_column", {
      p_column_id: COL_A,
      p_moves: [{ task_id: T1, target_column_id: COL_B }],
    });

    expect(error?.message).toMatch(/changed since it was listed/);
    expect((t.board_columns as Row[])).toHaveLength(2);
    expect((t.tasks as Row[])[0].board_column_id).toBe(COL_A);
  });

  it("refuses deleting the workspace's last non-terminal column", async () => {
    const t = tables();
    t.board_columns = [(t.board_columns as Row[])[0]];
    (t.tasks as Row[]).forEach((task) => (task.board_column_id = COL_A));
    const fake = createFakeSupabase({ tables: t });

    const { error } = await fake.rpc("delete_board_column", {
      p_column_id: COL_A,
      p_moves: [
        { task_id: T1, target_column_id: COL_A },
        { task_id: T2, target_column_id: COL_A },
      ],
    });

    expect(error?.message).toMatch(/last non-terminal column/);
    expect((t.board_columns as Row[])).toHaveLength(1);
  });
});

describe("query filters — not() and lt()", () => {
  function rows(): Row[] {
    return [
      { id: "1", completed_at: null },
      { id: "2", completed_at: "2026-06-01T00:00:00.000Z" },
      { id: "3", completed_at: "2026-08-01T00:00:00.000Z" },
    ];
  }

  it("not('col', 'is', null) excludes rows where the column is null", async () => {
    const fake = createFakeSupabase({ tables: { widgets: rows() } });

    const { data } = await fake.from("widgets").select().not("completed_at", "is", null);

    expect((data as Row[]).map((r) => r.id).sort()).toEqual(["2", "3"]);
  });

  it("lt('col', value) keeps only rows strictly less than the value", async () => {
    const fake = createFakeSupabase({ tables: { widgets: rows() } });

    const { data } = await fake
      .from("widgets")
      .select()
      .not("completed_at", "is", null)
      .lt("completed_at", "2026-07-01T00:00:00.000Z");

    expect((data as Row[]).map((r) => r.id)).toEqual(["2"]);
  });

  it("not() rejects an operator this fake does not implement", async () => {
    const fake = createFakeSupabase({ tables: { widgets: rows() } });

    expect(() => fake.from("widgets").select().not("completed_at", "eq", null)).toThrow(
      /unsupported not\(\) operator/
    );
  });

  it("lte('col', value) keeps rows less than or equal to the value", async () => {
    const fake = createFakeSupabase({ tables: { widgets: rows() } });

    const { data } = await fake
      .from("widgets")
      .select()
      .not("completed_at", "is", null)
      .lte("completed_at", "2026-06-01T00:00:00.000Z");

    expect((data as Row[]).map((r) => r.id)).toEqual(["2"]);
  });
});
