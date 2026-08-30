jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createFakeSupabase, type Row, type Tables } from "@/test/supabase-fake";
import { loadOlderDone, moveTaskToColumn } from "./move-actions";

beforeEach(() => jest.clearAllMocks());

const WS1 = "a0000000-0000-4000-8000-000000000001";
const WS2 = "a0000000-0000-4000-8000-000000000002";
const M1 = "b0000000-0000-4000-8000-000000000001";
const M1_WS2 = "b0000000-0000-4000-8000-000000000004";
const COL_A = "e0000000-0000-4000-8000-00000000000a";
const COL_B = "e0000000-0000-4000-8000-00000000000b";
const COL_DONE = "e0000000-0000-4000-8000-00000000000d";
const COL_WS2 = "e0000000-0000-4000-8000-00000000000f";
const T1 = "c0000000-0000-4000-8000-000000000001";
const T2 = "c0000000-0000-4000-8000-000000000002";
const SUB = "d0000000-0000-4000-8000-000000000002";

function seed(): Tables {
  return {
    workspace_members: [
      { id: M1, workspace_id: WS1, auth_user_id: "auth-user-1", display_name: "Alice" },
      { id: M1_WS2, workspace_id: WS2, auth_user_id: "auth-user-1", display_name: "Alice" },
    ],
    board_columns: [
      { id: COL_A, workspace_id: WS1, name: "Blocked", color: "tab20-red", position: 1000, is_done: false },
      { id: COL_B, workspace_id: WS1, name: "In Progress", color: "tab20-blue", position: 2000, is_done: false },
      { id: COL_DONE, workspace_id: WS1, name: "Completed", color: "tab20-green", position: 3000, is_done: true },
      { id: COL_WS2, workspace_id: WS2, name: "Not Started", color: "tab20-grey", position: 1000, is_done: false },
    ],
    tasks: [
      { id: T1, workspace_id: WS1, parent_task_id: null, completed_at: null, title: "T1", board_column_id: COL_A },
      { id: T2, workspace_id: WS1, parent_task_id: null, completed_at: null, title: "T2", board_column_id: COL_B },
      { id: SUB, workspace_id: null, parent_task_id: T1, completed_at: null, title: "Sub", board_column_id: null },
    ],
    task_assignments: [
      { task_id: T1, member_id: M1, member_sort_key: 1000 },
      { task_id: T2, member_id: M1, member_sort_key: 2000 },
      { task_id: SUB, member_id: M1, member_sort_key: 3000 },
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

const taskIn = (t: Tables, id: string) => (t.tasks as Row[]).find((r) => r.id === id)!;
const keyFor = (t: Tables, id: string) =>
  (t.task_assignments as Row[]).find((r) => r.task_id === id && r.member_id === M1)!.member_sort_key;

async function expectFailure(promise: Promise<{ ok: boolean }>, expected: string) {
  expect(await promise).toEqual({ ok: false, error: expect.stringContaining(expected) });
}

// ─── moveTaskToColumn ────────────────────────────────────────────────────────

it("moves the card to the new column and repositions it for the dragger", async () => {
  const fake = setup();

  const result = await moveTaskToColumn({
    taskId: T1,
    columnId: COL_B,
    memberId: M1,
    prevKey: 2000,
    nextKey: null,
  });

  expect(result.ok).toBe(true);
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_B);
  expect(keyFor(fake.tables, T1)).toBe(3000);
});

it("completes the task when the destination is the terminal column", async () => {
  const fake = setup();

  const result = await moveTaskToColumn({
    taskId: T1,
    columnId: COL_DONE,
    memberId: M1,
    prevKey: null,
    nextKey: null,
  });

  expect(result.ok).toBe(true);
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_DONE);
  expect(taskIn(fake.tables, T1).completed_at).not.toBeNull();
  // completeTask's existing cascade still applies: an open subtask closes with its parent.
  expect(taskIn(fake.tables, SUB).completed_at).not.toBeNull();
});

it("reopens the task when it is dragged out of the terminal column", async () => {
  const tables = seed();
  taskIn(tables, T1).completed_at = "2026-08-20T10:00:00.000Z";
  taskIn(tables, T1).board_column_id = COL_DONE;
  const fake = setup({ tables });

  const result = await moveTaskToColumn({
    taskId: T1,
    columnId: COL_A,
    memberId: M1,
    prevKey: null,
    nextKey: null,
  });

  expect(result.ok).toBe(true);
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_A);
  expect(taskIn(fake.tables, T1).completed_at).toBeNull();
});

it("leaves completion alone when both columns are non-terminal", async () => {
  const fake = setup();

  await moveTaskToColumn({ taskId: T1, columnId: COL_B, memberId: M1, prevKey: null, nextKey: null });

  expect(taskIn(fake.tables, T1).completed_at).toBeNull();
});

it("refuses a column belonging to another workspace", async () => {
  const fake = setup();

  await expectFailure(
    moveTaskToColumn({ taskId: T1, columnId: COL_WS2, memberId: M1, prevKey: null, nextKey: null }),
    "not in workspace"
  );
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_A);
});

// M1_WS2 is the same human in another workspace, so memberIdsForUser contains it and the action's
// own guard does not fire — the RPC's workspace check is what rejects this one.
it("refuses a member id from the caller's other workspace", async () => {
  const fake = setup();

  await expectFailure(
    moveTaskToColumn({ taskId: T1, columnId: COL_B, memberId: M1_WS2, prevKey: null, nextKey: null }),
    "is not in workspace"
  );
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_A);
});

// A member belonging to a different person is what the action's own guard exists for.
it("refuses a member id belonging to someone else", async () => {
  const tables = seed();
  const M_OTHER = "b0000000-0000-4000-8000-000000000009";
  (tables.workspace_members as Row[]).push({
    id: M_OTHER,
    workspace_id: WS1,
    auth_user_id: "auth-user-2",
    display_name: "Bob",
  });
  const fake = setup({ tables });

  await expectFailure(
    moveTaskToColumn({ taskId: T1, columnId: COL_B, memberId: M_OTHER, prevKey: null, nextKey: null }),
    "does not belong to the current user"
  );
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_A);
});

it("refuses to move a subtask", async () => {
  const fake = setup();

  await expectFailure(
    moveTaskToColumn({ taskId: SUB, columnId: COL_B, memberId: M1, prevKey: null, nextKey: null }),
    "subtask"
  );
  expect(taskIn(fake.tables, SUB).board_column_id).toBeNull();
});

it("signed out, moves nothing", async () => {
  const fake = setup({ user: null });

  await expectFailure(
    moveTaskToColumn({ taskId: T1, columnId: COL_B, memberId: M1, prevKey: null, nextKey: null }),
    "Unauthorized"
  );
  expect(taskIn(fake.tables, T1).board_column_id).toBe(COL_A);
});

// ─── loadOlderDone ───────────────────────────────────────────────────────────

// completed_at literals below are seeded in PostgREST's own serialisation ("+00:00"), not
// Date.toISOString()'s ("Z") — verified against the dev project's live REST API. Seeding it any
// other way lets the fake echo back exactly what it was given, which is not what Postgres does,
// and that mismatch is precisely what hid the production bug this cursor fix addresses.

it("returns completed tasks strictly older than the cursor, newest first", async () => {
  const tables = seed();
  (tables.tasks as Row[]).push(
    { id: "c0000000-0000-4000-8000-000000000010", workspace_id: WS1, parent_task_id: null, title: "Older", due_at: null, completed_at: "2026-07-01T10:00:00+00:00", board_column_id: COL_DONE },
    { id: "c0000000-0000-4000-8000-000000000011", workspace_id: WS1, parent_task_id: null, title: "Oldest", due_at: null, completed_at: "2026-06-01T10:00:00+00:00", board_column_id: COL_DONE },
    { id: "c0000000-0000-4000-8000-000000000012", workspace_id: WS1, parent_task_id: null, title: "Newer", due_at: null, completed_at: "2026-08-20T10:00:00+00:00", board_column_id: COL_DONE }
  );
  (tables.task_assignments as Row[]).push(
    { task_id: "c0000000-0000-4000-8000-000000000010", member_id: M1, member_sort_key: 4000 },
    { task_id: "c0000000-0000-4000-8000-000000000011", member_id: M1, member_sort_key: 5000 },
    { task_id: "c0000000-0000-4000-8000-000000000012", member_id: M1, member_sort_key: 6000 }
  );
  setup({ tables });

  const result = await loadOlderDone({ workspaceIds: [WS1], before: "2026-08-01T00:00:00.000Z" });

  expect(result).toMatchObject({ ok: true, hasMore: false });
  expect(result.ok && result.tasks.map((t) => t.title)).toEqual(["Older", "Oldest"]);
});

it("returns nothing when no completed task is older than the cursor", async () => {
  setup();

  const result = await loadOlderDone({ workspaceIds: [WS1], before: "2026-01-01T00:00:00.000Z" });

  expect(result).toEqual({ ok: true, tasks: [], hasMore: false });
});

it("refuses a workspace the user does not belong to", async () => {
  setup();
  await expectFailure(
    loadOlderDone({ workspaceIds: ["a0000000-0000-4000-8000-000000000009"], before: "2026-08-01T00:00:00.000Z" }),
    "not a member of workspace"
  );
});

// Amendment 3: the client sends Date.prototype.toISOString() output as the initial cursor, and the
// server hands back completed_at values read straight from the fake, which the client then feeds
// back as the *next* cursor unchanged. If that round trip did not validate, the second page would
// fail with a schema error the user could never explain from the UI.
it("accepts a completed_at value returned from a page as the cursor for the next page", async () => {
  const tables = seed();
  (tables.tasks as Row[]).push({
    id: "c0000000-0000-4000-8000-000000000010",
    workspace_id: WS1,
    parent_task_id: null,
    title: "Older",
    due_at: null,
    completed_at: "2026-07-01T10:00:00+00:00",
    board_column_id: COL_DONE,
  });
  (tables.task_assignments as Row[]).push({
    task_id: "c0000000-0000-4000-8000-000000000010",
    member_id: M1,
    member_sort_key: 4000,
  });
  setup({ tables });

  const firstPage = await loadOlderDone({
    workspaceIds: [WS1],
    before: new Date("2026-08-01T00:00:00.000Z").toISOString(),
  });
  expect(firstPage.ok).toBe(true);
  const cursor = firstPage.ok ? firstPage.tasks[0].completedAt : undefined;
  expect(cursor).toBeDefined();

  const secondPage = await loadOlderDone({ workspaceIds: [WS1], before: cursor as string });

  expect(secondPage).toEqual({ ok: true, tasks: [], hasMore: false });
});

// Pins the real format directly, independent of the fake and of the round-trip test above: this is
// verbatim what dev's REST API returned for a timestamptz column just now. Confirmed failing before
// loadOlderDoneSchema.before gained { offset: true } — the schema previously accepted only a
// literal "Z" suffix and rejected a numeric offset outright.
it("accepts the literal offset-suffixed format PostgREST serialises timestamptz as", async () => {
  const tables = seed();
  setup({ tables });

  const result = await loadOlderDone({
    workspaceIds: [WS1],
    before: "2026-07-27T16:44:26.319+00:00",
  });

  expect(result).toEqual({ ok: true, tasks: [], hasMore: false });
});

// Two tasks sharing a completed_at straddling a page boundary: ordering by completed_at alone and
// paging with a plain "<" comparison would drop whichever one lands just below the cut, because the
// next cursor IS that shared value and a strict "<" excludes everything at it. Bulk completion and
// the recurrence cron both make ties like this plausible.
it("returns both tasks of a tie straddling a page boundary, across two pages, with no skip and no repeat", async () => {
  const tables = seed();
  const TIE_AT = "2026-05-01T00:00:00+00:00";
  const TIE_HIGH = "c0000000-0000-4000-8000-000000000098"; // sorts after TIE_LOW — the last row of page 1
  const TIE_LOW = "c0000000-0000-4000-8000-000000000001"; // sorts before TIE_HIGH — must surface on page 2

  // DONE_PAGE_SIZE (50) distinct, newer completed_at values fill page 1 ahead of the tie, so the
  // 50th slot lands exactly on TIE_HIGH and the boundary falls inside the tied pair.
  for (let i = 0; i < 49; i++) {
    const id = `c1000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
    const at = new Date(Date.UTC(2026, 7, 1) - i * 60_000).toISOString();
    (tables.tasks as Row[]).push({
      id,
      workspace_id: WS1,
      parent_task_id: null,
      title: `Filler ${i}`,
      due_at: null,
      completed_at: at,
      board_column_id: COL_DONE,
    });
    (tables.task_assignments as Row[]).push({ task_id: id, member_id: M1, member_sort_key: 10_000 + i });
  }
  (tables.tasks as Row[]).push(
    { id: TIE_HIGH, workspace_id: WS1, parent_task_id: null, title: "Tie high", due_at: null, completed_at: TIE_AT, board_column_id: COL_DONE },
    { id: TIE_LOW, workspace_id: WS1, parent_task_id: null, title: "Tie low", due_at: null, completed_at: TIE_AT, board_column_id: COL_DONE }
  );
  (tables.task_assignments as Row[]).push(
    { task_id: TIE_HIGH, member_id: M1, member_sort_key: 20_000 },
    { task_id: TIE_LOW, member_id: M1, member_sort_key: 20_001 }
  );
  setup({ tables });

  const firstPage = await loadOlderDone({ workspaceIds: [WS1], before: new Date("2026-09-01T00:00:00.000Z").toISOString() });
  expect(firstPage.ok).toBe(true);
  if (!firstPage.ok) return;

  expect(firstPage.tasks).toHaveLength(50);
  expect(firstPage.hasMore).toBe(true);
  const last = firstPage.tasks[firstPage.tasks.length - 1];
  expect(last.id).toBe(TIE_HIGH);

  const secondPage = await loadOlderDone({
    workspaceIds: [WS1],
    before: last.completedAt,
    beforeId: last.id,
  });
  expect(secondPage.ok).toBe(true);
  if (!secondPage.ok) return;

  expect(secondPage.tasks.map((t) => t.id)).toEqual([TIE_LOW]);
  expect(secondPage.hasMore).toBe(false);

  const seenIds = [...firstPage.tasks, ...secondPage.tasks].map((t) => t.id);
  expect(new Set(seenIds).size).toBe(seenIds.length);
  expect(seenIds).toContain(TIE_LOW);
  expect(seenIds).toContain(TIE_HIGH);
});

// Regression guard for round 2's finding: the query must stay bounded by DONE_PAGE_SIZE + 1 +
// DONE_TIE_ALLOWANCE in the database rather than fetching every matching row and paging in Node.
// The fake has no notion of query cost, so this cannot prove boundedness by itself (see the
// findings file) — it pins the pagination contract (at most one page, hasMore true when more exist)
// that the bounded query has to keep honouring, alongside `.limit()` being visible in the diff.
it("returns at most one page and reports more remaining when far more completed tasks exist", async () => {
  const tables = seed();
  const COUNT = 120;
  for (let i = 0; i < COUNT; i++) {
    const id = `c2000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const at = new Date(Date.UTC(2026, 0, 1) - i * 60_000).toISOString();
    (tables.tasks as Row[]).push({
      id,
      workspace_id: WS1,
      parent_task_id: null,
      title: `Bulk ${i}`,
      due_at: null,
      completed_at: at,
      board_column_id: COL_DONE,
    });
    (tables.task_assignments as Row[]).push({ task_id: id, member_id: M1, member_sort_key: 30_000 + i });
  }
  setup({ tables });

  const result = await loadOlderDone({
    workspaceIds: [WS1],
    before: new Date("2026-02-01T00:00:00.000Z").toISOString(),
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.tasks.length).toBeLessThanOrEqual(50);
  expect(result.tasks).toHaveLength(50);
  expect(result.hasMore).toBe(true);
});

// The done column's "Show older" footer can be offered with nothing on screen yet — the client
// then has no row to cite and sends only the synthetic cutoff as `before`, no `beforeId`. This must
// keep working: it is not a degraded fallback, it is the first page's own normal shape.
it("returns older tasks when before is given without beforeId", async () => {
  const tables = seed();
  (tables.tasks as Row[]).push({
    id: "c0000000-0000-4000-8000-000000000020",
    workspace_id: WS1,
    parent_task_id: null,
    title: "No cursor row cited",
    due_at: null,
    completed_at: "2026-07-01T10:00:00+00:00",
    board_column_id: COL_DONE,
  });
  (tables.task_assignments as Row[]).push({
    task_id: "c0000000-0000-4000-8000-000000000020",
    member_id: M1,
    member_sort_key: 4000,
  });
  setup({ tables });

  const result = await loadOlderDone({ workspaceIds: [WS1], before: "2026-08-01T00:00:00+00:00" });

  expect(result).toEqual({
    ok: true,
    tasks: [
      expect.objectContaining({ id: "c0000000-0000-4000-8000-000000000020", title: "No cursor row cited" }),
    ],
    hasMore: false,
  });
});
