import {
  DONE_WINDOW_DAYS,
  groupTasks,
  mergeColumns,
  resolveDropTarget,
  type BoardColumn,
  type BoardTask,
} from "./group-columns";

const WS_H = "a0000000-0000-4000-8000-000000000001";
const WS_W = "a0000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-08-28T12:00:00.000Z");

function column(overrides: Partial<BoardColumn> & { id: string; workspaceId: string; name: string }): BoardColumn {
  return { color: "tab20-blue", position: 1000, isDone: false, ...overrides };
}

function task(overrides: Partial<BoardTask> & { id: string; boardColumnId: string; workspaceId: string }): BoardTask {
  return {
    title: "A task",
    dueAt: null,
    completedAt: null,
    workspaceName: "Household",
    workspaceKind: "household",
    memberSortKey: 1000,
    assigneeCount: 1,
    ...overrides,
  };
}

describe("mergeColumns", () => {
  it("keeps one workspace's columns in position order", () => {
    const merged = mergeColumns([
      column({ id: "c2", workspaceId: WS_H, name: "In Progress", position: 2000 }),
      column({ id: "c1", workspaceId: WS_H, name: "Not Started", position: 1000 }),
    ]);

    expect(merged.map((m) => m.name)).toEqual(["Not Started", "In Progress"]);
    expect(merged[0].columnIdByWorkspaceId).toEqual({ [WS_H]: "c1" });
  });

  it("merges same-named columns across workspaces, case-insensitively", () => {
    const merged = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Blocked", position: 3000 }),
      column({ id: "w1", workspaceId: WS_W, name: "blocked", position: 1000 }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Blocked");
    expect(merged[0].columnIdByWorkspaceId).toEqual({ [WS_H]: "h1", [WS_W]: "w1" });
  });

  it("takes the lowest position of the columns it merged", () => {
    const merged = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Blocked", position: 3000 }),
      column({ id: "w1", workspaceId: WS_W, name: "Blocked", position: 1000 }),
      column({ id: "h2", workspaceId: WS_H, name: "Done", position: 2000, isDone: true }),
    ]);

    expect(merged.map((m) => m.name)).toEqual(["Blocked", "Done"]);
    expect(merged[0].position).toBe(1000);
  });

  it("keeps a shared colour and drops to null when merged columns disagree", () => {
    const agreeing = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Blocked", color: "tab20-red" }),
      column({ id: "w1", workspaceId: WS_W, name: "Blocked", color: "tab20-red" }),
    ]);
    const disagreeing = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Blocked", color: "tab20-red" }),
      column({ id: "w1", workspaceId: WS_W, name: "Blocked", color: "tab20-cyan" }),
    ]);

    expect(agreeing[0].color).toBe("tab20-red");
    expect(disagreeing[0].color).toBeNull();
  });

  it("is terminal when any merged column is terminal", () => {
    const merged = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Completed", isDone: true }),
      column({ id: "w1", workspaceId: WS_W, name: "Completed", isDone: false }),
    ]);

    expect(merged[0].isDone).toBe(true);
  });

  it("keeps a name unique to one workspace as its own column", () => {
    const merged = mergeColumns([
      column({ id: "h1", workspaceId: WS_H, name: "Not Started", position: 1000 }),
      column({ id: "w1", workspaceId: WS_W, name: "Waiting on legal", position: 2000 }),
    ]);

    expect(merged.map((m) => m.name)).toEqual(["Not Started", "Waiting on legal"]);
  });
});

describe("groupTasks", () => {
  const columns = mergeColumns([
    column({ id: "h1", workspaceId: WS_H, name: "Not Started", position: 1000 }),
    column({ id: "h2", workspaceId: WS_H, name: "Completed", position: 2000, isDone: true }),
  ]);

  it("buckets a task under the merged column its own column belongs to", () => {
    const grouped = groupTasks(columns, [task({ id: "t1", boardColumnId: "h1", workspaceId: WS_H })], NOW);

    expect(grouped["not started"].map((t) => t.id)).toEqual(["t1"]);
    expect(grouped["completed"]).toEqual([]);
  });

  it("sorts each column by the viewer's own priority", () => {
    const grouped = groupTasks(
      columns,
      [
        task({ id: "low", boardColumnId: "h1", workspaceId: WS_H, memberSortKey: 3000 }),
        task({ id: "high", boardColumnId: "h1", workspaceId: WS_H, memberSortKey: 1000 }),
      ],
      NOW
    );

    expect(grouped["not started"].map((t) => t.id)).toEqual(["high", "low"]);
  });

  it("puts a completed task in the terminal column whatever its board_column_id says", () => {
    const grouped = groupTasks(
      columns,
      [
        task({
          id: "done",
          boardColumnId: "h1",
          workspaceId: WS_H,
          completedAt: "2026-08-27T09:00:00.000Z",
        }),
      ],
      NOW
    );

    expect(grouped["not started"]).toEqual([]);
    expect(grouped["completed"].map((t) => t.id)).toEqual(["done"]);
  });

  it("shows only the last 7 days of completed work, newest first", () => {
    const grouped = groupTasks(
      columns,
      [
        task({ id: "recent", boardColumnId: "h2", workspaceId: WS_H, completedAt: "2026-08-27T09:00:00.000Z" }),
        task({ id: "older", boardColumnId: "h2", workspaceId: WS_H, completedAt: "2026-08-26T09:00:00.000Z" }),
        task({ id: "ancient", boardColumnId: "h2", workspaceId: WS_H, completedAt: "2026-07-01T09:00:00.000Z" }),
      ],
      NOW
    );

    expect(grouped["completed"].map((t) => t.id)).toEqual(["recent", "older"]);
    expect(DONE_WINDOW_DAYS).toBe(7);
  });

  it("drops a completed task entirely when no terminal column exists", () => {
    const noTerminal = mergeColumns([column({ id: "h1", workspaceId: WS_H, name: "Not Started" })]);

    const grouped = groupTasks(
      noTerminal,
      [task({ id: "done", boardColumnId: "h1", workspaceId: WS_H, completedAt: "2026-08-27T09:00:00.000Z" })],
      NOW
    );

    expect(grouped["not started"]).toEqual([]);
  });

  it("keeps an open task out of the terminal column even if that is where its column points", () => {
    // Legacy rows can exist: a task dragged into Done and then reopened before migration 019 and
    // the reopenTask fix landed. The terminal column means "completed" on this board, so an open
    // card there would contradict its own pill.
    const grouped = groupTasks(
      columns,
      [task({ id: "reopened", boardColumnId: "h2", workspaceId: WS_H, completedAt: null })],
      NOW
    );

    expect(grouped["completed"]).toEqual([]);
    expect(grouped["not started"].map((t) => t.id)).toEqual(["reopened"]);
  });

  it("ignores a task whose column is not on the board", () => {
    const grouped = groupTasks(columns, [task({ id: "stray", boardColumnId: "gone", workspaceId: WS_H })], NOW);

    expect(Object.values(grouped).flat()).toEqual([]);
  });
});

describe("resolveDropTarget", () => {
  const merged = mergeColumns([
    column({ id: "h1", workspaceId: WS_H, name: "Blocked" }),
    column({ id: "w1", workspaceId: WS_W, name: "Blocked" }),
    column({ id: "w2", workspaceId: WS_W, name: "Waiting on legal" }),
  ]);

  it("resolves to the column of the card's own workspace", () => {
    expect(resolveDropTarget(merged[0], WS_H)).toBe("h1");
    expect(resolveDropTarget(merged[0], WS_W)).toBe("w1");
  });

  it("returns null when the card's workspace has no column by that name", () => {
    const waiting = merged.find((m) => m.name === "Waiting on legal")!;
    expect(resolveDropTarget(waiting, WS_H)).toBeNull();
  });
});
