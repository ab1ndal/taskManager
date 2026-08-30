jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createFakeSupabase, type Row, type Tables } from "@/test/supabase-fake";
import { GENERIC_ERROR } from "@/app/tasks/action-result";
import {
  createBoardColumn,
  deleteBoardColumn,
  listTasksInColumn,
  renameBoardColumn,
  reorderBoardColumn,
  setBoardColumnColor,
} from "./actions";

beforeEach(() => jest.clearAllMocks());

const WS1 = "a0000000-0000-4000-8000-000000000001";
const WS2 = "a0000000-0000-4000-8000-000000000002";
const M1 = "b0000000-0000-4000-8000-000000000001";
const M_OUTSIDER = "b0000000-0000-4000-8000-000000000003";
const COL_A = "e0000000-0000-4000-8000-00000000000a";
const COL_B = "e0000000-0000-4000-8000-00000000000b";
const COL_DONE = "e0000000-0000-4000-8000-00000000000d";
const COL_WS2 = "e0000000-0000-4000-8000-00000000000f";
const T1 = "c0000000-0000-4000-8000-000000000001";
const T2 = "c0000000-0000-4000-8000-000000000002";
const T3 = "c0000000-0000-4000-8000-000000000003";

/** WS1 has three columns and two tasks in COL_A; WS2 exists so cross-workspace cases are real. */
function seed(): Tables {
  return {
    workspace_members: [
      { id: M1, workspace_id: WS1, auth_user_id: "auth-user-1", display_name: "Alice" },
      { id: M_OUTSIDER, workspace_id: WS2, auth_user_id: "auth-user-3", display_name: "Carol" },
    ],
    board_columns: [
      { id: COL_A, workspace_id: WS1, name: "Blocked", color: "tab20-red", position: 1000, is_done: false },
      { id: COL_B, workspace_id: WS1, name: "In Progress", color: "tab20-blue", position: 2000, is_done: false },
      { id: COL_DONE, workspace_id: WS1, name: "Completed", color: "tab20-green", position: 3000, is_done: true },
      { id: COL_WS2, workspace_id: WS2, name: "Not Started", color: "tab20-grey", position: 1000, is_done: false },
    ],
    tasks: [
      { id: T1, workspace_id: WS1, parent_task_id: null, completed_at: null, title: "Call the plumber", board_column_id: COL_A },
      { id: T2, workspace_id: WS1, parent_task_id: null, completed_at: null, title: "Fix the light", board_column_id: COL_A },
    ],
    task_assignments: [
      { task_id: T1, member_id: M1, member_sort_key: 1000 },
      { task_id: T2, member_id: M1, member_sort_key: 2000 },
    ],
  };
}

function setup(options: { tables?: Tables; user?: { id: string } | null } = {}) {
  const fake = createFakeSupabase({
    tables: options.tables ?? seed(),
    user: options.user === undefined ? { id: "auth-user-1" } : options.user,
  });
  (createClient as jest.Mock).mockResolvedValue(fake);
  (createAdminClient as jest.Mock).mockReturnValue(fake);
  return fake;
}

const columnsIn = (t: Tables) => t.board_columns as Row[];
const tasksIn = (t: Tables) => t.tasks as Row[];

async function expectFailure(promise: Promise<{ ok: boolean }>, expected: string) {
  expect(await promise).toEqual({ ok: false, error: expect.stringContaining(expected) });
}

// ─── createBoardColumn ───────────────────────────────────────────────────────

it("creates a column at the end of the workspace's list", async () => {
  const fake = setup();

  const result = await createBoardColumn({ workspaceId: WS1, name: "Waiting", color: "tab20-cyan" });

  expect(result.ok).toBe(true);
  const created = columnsIn(fake.tables).find((c) => c.name === "Waiting");
  expect(created).toMatchObject({ workspace_id: WS1, color: "tab20-cyan", is_done: false });
  expect(created!.position).toBeGreaterThan(3000);
});

it("refuses to create a column in a workspace the user does not belong to", async () => {
  const fake = setup();

  await expectFailure(
    createBoardColumn({ workspaceId: WS2, name: "Waiting", color: "tab20-cyan" }),
    "not a member of workspace"
  );
  expect(columnsIn(fake.tables).filter((c) => c.workspace_id === WS2)).toHaveLength(1);
});

it("signed out, creates nothing", async () => {
  const fake = setup({ user: null });

  await expectFailure(
    createBoardColumn({ workspaceId: WS1, name: "Waiting", color: "tab20-cyan" }),
    "Unauthorized"
  );
  expect(columnsIn(fake.tables)).toHaveLength(4);
});

// ─── renameBoardColumn ───────────────────────────────────────────────────────

it("renames in place, leaving every task's column untouched", async () => {
  const fake = setup();

  const result = await renameBoardColumn({ columnId: COL_A, name: "Parked" });

  expect(result.ok).toBe(true);
  expect(columnsIn(fake.tables).find((c) => c.id === COL_A)!.name).toBe("Parked");
  expect(tasksIn(fake.tables).map((t) => t.board_column_id)).toEqual([COL_A, COL_A]);
});

it("refuses to rename a column in another workspace", async () => {
  setup();
  await expectFailure(renameBoardColumn({ columnId: COL_WS2, name: "Parked" }), "not a member of workspace");
});

// ─── setBoardColumnColor ─────────────────────────────────────────────────────

it("changes only the colour", async () => {
  const fake = setup();

  const result = await setBoardColumnColor({ columnId: COL_A, color: "tab20-olive" });

  expect(result.ok).toBe(true);
  expect(columnsIn(fake.tables).find((c) => c.id === COL_A)).toMatchObject({
    color: "tab20-olive",
    name: "Blocked",
    position: 1000,
  });
});

// ─── listTasksInColumn ───────────────────────────────────────────────────────

it("lists the column's tasks in the caller's own priority order", async () => {
  const tables = seed();
  (tables.task_assignments as Row[])[1].member_sort_key = 500; // T2 outranks T1 for this user
  setup({ tables });

  const result = await listTasksInColumn({ columnId: COL_A });

  expect(result).toEqual({
    ok: true,
    tasks: [
      { id: T2, title: "Fix the light", completedAt: null },
      { id: T1, title: "Call the plumber", completedAt: null },
    ],
  });
});

it("returns an empty list for a column with no tasks", async () => {
  setup();
  expect(await listTasksInColumn({ columnId: COL_B })).toEqual({ ok: true, tasks: [] });
});

it("includes a task the caller has no assignment for, sorted last", async () => {
  const tables = seed();
  (tables.tasks as Row[]).push({
    id: T3,
    workspace_id: WS1,
    parent_task_id: null,
    completed_at: null,
    title: "Nobody's task",
    board_column_id: COL_A,
  });
  // Deliberately no task_assignments row for T3/M1: the caller isn't assigned to it.
  setup({ tables });

  const result = await listTasksInColumn({ columnId: COL_A });

  expect(result.ok).toBe(true);
  const tasks = (result as { ok: true; tasks: { id: string }[] }).tasks;
  expect(tasks.map((t) => t.id)).toEqual([T1, T2, T3]);
});

// ─── deleteBoardColumn ───────────────────────────────────────────────────────

it("applies each task's own destination and removes the column", async () => {
  const fake = setup();

  const result = await deleteBoardColumn({
    columnId: COL_A,
    moves: [
      { taskId: T1, targetColumnId: COL_B },
      { taskId: T2, targetColumnId: COL_DONE },
    ],
  });

  expect(result.ok).toBe(true);
  expect(tasksIn(fake.tables).find((t) => t.id === T1)!.board_column_id).toBe(COL_B);
  expect(tasksIn(fake.tables).find((t) => t.id === T2)!.board_column_id).toBe(COL_DONE);
  expect(columnsIn(fake.tables).some((c) => c.id === COL_A)).toBe(false);
});

it("deletes an empty column with no moves", async () => {
  const fake = setup();

  const result = await deleteBoardColumn({ columnId: COL_B, moves: [] });

  expect(result.ok).toBe(true);
  expect(columnsIn(fake.tables).some((c) => c.id === COL_B)).toBe(false);
});

it("refuses a partial move list and changes nothing", async () => {
  const fake = setup();

  await expectFailure(
    deleteBoardColumn({ columnId: COL_A, moves: [{ taskId: T1, targetColumnId: COL_B }] }),
    "changed since it was listed"
  );
  expect(columnsIn(fake.tables).some((c) => c.id === COL_A)).toBe(true);
  expect(tasksIn(fake.tables).map((t) => t.board_column_id)).toEqual([COL_A, COL_A]);
});

it("refuses a destination in another workspace", async () => {
  const fake = setup();

  await expectFailure(
    deleteBoardColumn({
      columnId: COL_A,
      moves: [
        { taskId: T1, targetColumnId: COL_WS2 },
        { taskId: T2, targetColumnId: COL_B },
      ],
    }),
    "different column in workspace"
  );
  expect(columnsIn(fake.tables).some((c) => c.id === COL_A)).toBe(true);
});

it("refuses to delete a column in another workspace", async () => {
  setup();
  await expectFailure(deleteBoardColumn({ columnId: COL_WS2, moves: [] }), "not a member of workspace");
});

it("refuses to delete the workspace's last non-terminal column", async () => {
  const tables = seed();
  // Drop COL_B so WS1 has exactly one non-terminal column (COL_A) left, plus the terminal COL_DONE.
  tables.board_columns = (tables.board_columns as Row[]).filter((c) => c.id !== COL_B);
  const fake = setup({ tables });

  await expectFailure(
    deleteBoardColumn({ columnId: COL_A, moves: [] }),
    "cannot delete the last non-terminal column of workspace"
  );
  expect(columnsIn(fake.tables).some((c) => c.id === COL_A)).toBe(true);
});

it("collapses an rpc failure we did not author to the generic message, without leaking its text", async () => {
  const fake = setup();
  const leaked = "permission denied for table board_columns";
  const originalRpc = fake.rpc.bind(fake);
  jest.spyOn(fake, "rpc").mockImplementation(async (fnName: string, params: Record<string, unknown>) =>
    fnName === "delete_board_column" ? { data: null, error: { message: leaked } } : originalRpc(fnName, params)
  );
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});

  const result = await deleteBoardColumn({ columnId: COL_A, moves: [{ taskId: T1, targetColumnId: COL_B }, { taskId: T2, targetColumnId: COL_DONE }] });

  expect(result).toEqual({ ok: false, error: GENERIC_ERROR });
  expect(JSON.stringify(result)).not.toContain("permission denied");
  expect(logged).toHaveBeenCalledWith(expect.stringContaining(leaked));
  logged.mockRestore();
});

// ─── reorderBoardColumn ──────────────────────────────────────────────────────

it("writes the midpoint position between two neighbours", async () => {
  const fake = setup();

  const result = await reorderBoardColumn({ columnId: COL_A, prevPosition: 2000, nextPosition: 3000 });

  expect(result.ok).toBe(true);
  expect(columnsIn(fake.tables).find((c) => c.id === COL_A)!.position).toBe(2500);
});

it("does nothing when there is no neighbour on either side", async () => {
  const fake = setup();

  const result = await reorderBoardColumn({ columnId: COL_A, prevPosition: null, nextPosition: null });

  expect(result.ok).toBe(true);
  expect(columnsIn(fake.tables).find((c) => c.id === COL_A)!.position).toBe(1000);
});
