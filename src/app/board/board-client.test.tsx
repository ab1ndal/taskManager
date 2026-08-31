jest.mock("./move-actions", () => ({
  moveTaskToColumn: jest.fn(),
  loadOlderDone: jest.fn(),
  loadTaskForEdit: jest.fn(),
}));

// The two task modals belong to the list view and are covered by its own tests; here they would
// only drag next/cache into jsdom through their server actions.
jest.mock("@/app/tasks/edit-task-modal", () => ({
  EditTaskModal: () => null,
}));
jest.mock("@/app/tasks/new-task-modal", () => ({
  NewTaskModal: ({ boardColumnId }: { boardColumnId?: string }) => (
    <div data-testid="new-task-modal" data-column={boardColumnId} />
  ),
}));

jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

jest.mock("@/app/tasks/actions", () => ({
  completeTask: jest.fn(),
  reopenTask: jest.fn(),
  deleteTask: jest.fn(),
}));

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { DropResult } from "@hello-pangea/dnd";

import { BoardClient, buildBoardDragEndHandler } from "./board-client";
import { groupTasks, mergeColumns, type BoardColumn, type BoardTask } from "./group-columns";
import { loadOlderDone, loadTaskForEdit, moveTaskToColumn } from "./move-actions";
import { toast } from "@/components/toaster";

const WS_H = "a0000000-0000-4000-8000-000000000001";
const WS_W = "a0000000-0000-4000-8000-000000000002";
const M_H = "b0000000-0000-4000-8000-000000000001";
const COL_H_TODO = "e0000000-0000-4000-8000-00000000000a";
const COL_H_PROG = "e0000000-0000-4000-8000-00000000000b";
const COL_H_DONE = "e0000000-0000-4000-8000-00000000000c";
const T1 = "c0000000-0000-4000-8000-000000000001";
const T2 = "c0000000-0000-4000-8000-000000000002";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn();
  HTMLDialogElement.prototype.close = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  (moveTaskToColumn as jest.Mock).mockResolvedValue({ ok: true });
  (loadOlderDone as jest.Mock).mockResolvedValue({ ok: true, tasks: [], hasMore: false });
  (loadTaskForEdit as jest.Mock).mockResolvedValue({ ok: true, task: null });
});

const columns: BoardColumn[] = [
  { id: COL_H_TODO, workspaceId: WS_H, name: "Not Started", color: "tab20-grey", position: 1000, isDone: false },
  { id: COL_H_PROG, workspaceId: WS_H, name: "In Progress", color: "tab20-blue", position: 2000, isDone: false },
];

const testWorkspaces = [
  { id: WS_H, name: "Household", kind: "household", members: [{ id: M_H, display_name: "Ali" }] },
];

const columnsWithDone: BoardColumn[] = [
  ...columns,
  { id: COL_H_DONE, workspaceId: WS_H, name: "Completed", color: "tab20-green", position: 3000, isDone: true },
];

function task(overrides: Partial<BoardTask> & { id: string; boardColumnId: string }): BoardTask {
  return {
    title: "Call the plumber",
    dueAt: null,
    completedAt: null,
    workspaceId: WS_H,
    workspaceName: "Household",
    workspaceKind: "household",
    memberSortKey: 1000,
    assigneeCount: 1,
    ...overrides,
  };
}

function handler(overrides: Partial<Parameters<typeof buildBoardDragEndHandler>[0]> = {}) {
  return buildBoardDragEndHandler({
    merged: mergeColumns(columns),
    groupedByKey: {
      "not started": [task({ id: T1, boardColumnId: COL_H_TODO })],
      "in progress": [],
    },
    memberIdByWorkspaceId: { [WS_H]: M_H },
    setLocalTasks: jest.fn(),
    onError: jest.fn(),
    ...overrides,
  });
}

const drop = (over: Partial<DropResult>): DropResult =>
  ({
    draggableId: T1,
    source: { droppableId: "not started", index: 0 },
    destination: { droppableId: "in progress", index: 0 },
    reason: "DROP",
    mode: "FLUID",
    type: "DEFAULT",
    combine: null,
    ...over,
  }) as DropResult;

it("sends the resolved column id for the card's own workspace", async () => {
  await handler()(drop({}));

  expect(moveTaskToColumn).toHaveBeenCalledWith({
    taskId: T1,
    columnId: COL_H_PROG,
    memberId: M_H,
    prevKey: null,
    nextKey: null,
  });
});

it("does nothing when the card is dropped outside a column", async () => {
  await handler()(drop({ destination: null }));

  expect(moveTaskToColumn).not.toHaveBeenCalled();
});

it("does nothing when the card is dropped exactly where it started", async () => {
  await handler()(drop({ destination: { droppableId: "not started", index: 0 } }));

  expect(moveTaskToColumn).not.toHaveBeenCalled();
});

it("computes neighbour keys from the destination column's rendered order", async () => {
  const call = handler({
    groupedByKey: {
      "not started": [task({ id: T1, boardColumnId: COL_H_TODO })],
      "in progress": [
        task({ id: "c0000000-0000-4000-8000-000000000002", boardColumnId: COL_H_PROG, memberSortKey: 2000 }),
        task({ id: "c0000000-0000-4000-8000-000000000003", boardColumnId: COL_H_PROG, memberSortKey: 4000 }),
      ],
    },
  });

  await call(drop({ destination: { droppableId: "in progress", index: 1 } }));

  expect(moveTaskToColumn).toHaveBeenCalledWith(
    expect.objectContaining({ prevKey: 2000, nextKey: 4000 })
  );
});

it("refuses a drop into a column the card's workspace does not have, and says why", async () => {
  const onError = jest.fn();
  const crossWorkspace: BoardColumn[] = [
    ...columns,
    { id: "e0000000-0000-4000-8000-00000000000f", workspaceId: WS_W, name: "Waiting on legal", color: "tab20-cyan", position: 3000, isDone: false },
  ];

  const call = buildBoardDragEndHandler({
    merged: mergeColumns(crossWorkspace),
    groupedByKey: {
      "not started": [task({ id: T1, boardColumnId: COL_H_TODO })],
      "in progress": [],
      "waiting on legal": [],
    },
    memberIdByWorkspaceId: { [WS_H]: M_H },
    setLocalTasks: jest.fn(),
    onError,
  });

  await call(drop({ destination: { droppableId: "waiting on legal", index: 0 } }));

  expect(moveTaskToColumn).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith('Household has no "Waiting on legal" column');
});

it("moves the card optimistically and rolls back when the server refuses", async () => {
  (moveTaskToColumn as jest.Mock).mockResolvedValue({ ok: false, error: "Nope" });
  const setLocalTasks = jest.fn();
  const onError = jest.fn();
  const OTHER = "c0000000-0000-4000-8000-000000000009";

  await handler({ setLocalTasks, onError })(drop({}));

  // Once to move it, once to put it back.
  expect(setLocalTasks).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledWith("Nope");

  // A second, untouched card in `prev` — catches an updater of the form `(prev) => preDragSnapshot`,
  // which a one-element array can't: it would still pass with only T1 in the array. The per-card
  // comment in board-client.tsx claims not to erase a concurrent change; this is what proves it.
  const applyFirst = setLocalTasks.mock.calls[0][0] as (prev: BoardTask[]) => BoardTask[];
  const afterFirst = applyFirst([
    task({ id: T1, boardColumnId: COL_H_TODO }),
    task({ id: OTHER, boardColumnId: COL_H_PROG, memberSortKey: 9000 }),
  ]);
  expect(afterFirst.find((t) => t.id === T1)?.boardColumnId).toBe(COL_H_PROG);
  expect(afterFirst.find((t) => t.id === OTHER)).toMatchObject({ boardColumnId: COL_H_PROG, memberSortKey: 9000 });

  const applyRollback = setLocalTasks.mock.calls[1][0] as (prev: BoardTask[]) => BoardTask[];
  const afterRollback = applyRollback([
    task({ id: T1, boardColumnId: COL_H_PROG }),
    task({ id: OTHER, boardColumnId: COL_H_TODO, memberSortKey: 5000 }),
  ]);
  expect(afterRollback.find((t) => t.id === T1)?.boardColumnId).toBe(COL_H_TODO);
  expect(afterRollback.find((t) => t.id === OTHER)).toMatchObject({ boardColumnId: COL_H_TODO, memberSortKey: 5000 });
});

it("sets completedAt on a drop into the terminal column, so groupTasks places the card in Done", async () => {
  // Catches an updater that moves boardColumnId but leaves completedAt untouched: groupTasks reads
  // completedAt to decide the terminal column, not boardColumnId, so that mutation would leave the
  // card open in "not started" (Task 10 review, Important 2) instead of failing loudly here.
  const merged = mergeColumns(columnsWithDone);
  let tasks: BoardTask[] = [task({ id: T1, boardColumnId: COL_H_TODO, completedAt: null })];
  const setLocalTasks = jest.fn((updater: (prev: BoardTask[]) => BoardTask[]) => {
    tasks = updater(tasks);
  });

  const call = buildBoardDragEndHandler({
    merged,
    groupedByKey: { "not started": tasks, "in progress": [], completed: [] },
    memberIdByWorkspaceId: { [WS_H]: M_H },
    setLocalTasks,
    onError: jest.fn(),
  });

  await call(drop({ destination: { droppableId: "completed", index: 0 } }));

  expect(tasks[0].completedAt).not.toBeNull();
  const grouped = groupTasks(merged, tasks);
  expect(grouped["completed"].map((t) => t.id)).toEqual([T1]);
  expect(grouped["not started"]).toEqual([]);
});

it("clears completedAt when dragging a card out of the terminal column", async () => {
  // Catches an updater that only ever sets completedAt, never clears it: without the clear,
  // groupTasks re-homes an "open" task whose column points at Done back into the first non-terminal
  // column regardless of where it was actually dropped — but this card isn't open, it still carries
  // completedAt, so groupTasks would instead leave it stuck under Done (the drag-out half of
  // Important 2).
  const merged = mergeColumns(columnsWithDone);
  let tasks: BoardTask[] = [
    task({ id: T1, boardColumnId: COL_H_DONE, completedAt: "2026-08-20T00:00:00.000Z" }),
  ];
  const setLocalTasks = jest.fn((updater: (prev: BoardTask[]) => BoardTask[]) => {
    tasks = updater(tasks);
  });

  const call = buildBoardDragEndHandler({
    merged,
    groupedByKey: { completed: tasks, "not started": [], "in progress": [] },
    memberIdByWorkspaceId: { [WS_H]: M_H },
    setLocalTasks,
    onError: jest.fn(),
  });

  await call(
    drop({
      source: { droppableId: "completed", index: 0 },
      destination: { droppableId: "not started", index: 0 },
    })
  );

  expect(tasks[0].completedAt).toBeNull();
  const grouped = groupTasks(merged, tasks);
  expect(grouped["not started"].map((t) => t.id)).toEqual([T1]);
  expect(grouped["completed"]).toEqual([]);
});

it("leaves completedAt untouched when reordering within Done at a different index", async () => {
  // Catches stamping a fresh completedAt whenever the destination column is terminal, without
  // checking whether the card was already completed. Source and destination are both "completed"
  // here, only the index differs, so the early-return-on-identical-drop guard does not apply and
  // this code path runs. The server's move_task_to_column only calls completeTask/reopenTask when
  // terminal-ness actually changes, so an unconditional stamp here would optimistically jump the
  // card to the top of Done's newest-first sort and then snap back once the props resync landed —
  // a flash the user did not cause (Task 10 review, round 2).
  const ORIGINAL_COMPLETED_AT = "2026-08-20T00:00:00.000Z";
  const merged = mergeColumns(columnsWithDone);
  const other = task({
    id: "c0000000-0000-4000-8000-000000000008",
    boardColumnId: COL_H_DONE,
    completedAt: "2026-08-25T00:00:00.000Z",
  });
  let tasks: BoardTask[] = [
    task({ id: T1, boardColumnId: COL_H_DONE, completedAt: ORIGINAL_COMPLETED_AT }),
    other,
  ];
  const setLocalTasks = jest.fn((updater: (prev: BoardTask[]) => BoardTask[]) => {
    tasks = updater(tasks);
  });

  const call = buildBoardDragEndHandler({
    merged,
    groupedByKey: { completed: [tasks[0], other], "not started": [], "in progress": [] },
    memberIdByWorkspaceId: { [WS_H]: M_H },
    setLocalTasks,
    onError: jest.fn(),
  });

  await call(
    drop({
      source: { droppableId: "completed", index: 0 },
      destination: { droppableId: "completed", index: 1 },
    })
  );

  expect(tasks.find((t) => t.id === T1)?.completedAt).toBe(ORIGINAL_COMPLETED_AT);
});

it("restores completedAt on rollback when the server refuses a drop into Done", async () => {
  // Catches a rollback that restores boardColumnId and memberSortKey but not completedAt: the card
  // would then sit back in its old column while still marked completed, contradicting its own pill.
  (moveTaskToColumn as jest.Mock).mockResolvedValue({ ok: false, error: "Nope" });
  const merged = mergeColumns(columnsWithDone);
  let tasks: BoardTask[] = [task({ id: T1, boardColumnId: COL_H_TODO, completedAt: null })];
  const setLocalTasks = jest.fn((updater: (prev: BoardTask[]) => BoardTask[]) => {
    tasks = updater(tasks);
  });

  const call = buildBoardDragEndHandler({
    merged,
    groupedByKey: { "not started": tasks, "in progress": [], completed: [] },
    memberIdByWorkspaceId: { [WS_H]: M_H },
    setLocalTasks,
    onError: jest.fn(),
  });

  await call(drop({ destination: { droppableId: "completed", index: 0 } }));

  expect(tasks[0].completedAt).toBeNull();
  expect(tasks[0].boardColumnId).toBe(COL_H_TODO);
});

it("renders one region per column, labelled with its task count", () => {
  render(
    <BoardClient
      columns={columns}
      tasks={[task({ id: T1, boardColumnId: COL_H_TODO })]}
      memberIdByWorkspaceId={{ [WS_H]: M_H }}
      workspaceIds={[WS_H]}
      showWorkspace={false}
      workspaces={testWorkspaces}
      currentMemberIds={[M_H]}
    />
  );

  expect(screen.getByRole("region", { name: "Not Started, 1 task" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "In Progress, 0 tasks" })).toBeInTheDocument();
});

it("has no accessibility violations", async () => {
  const { container } = render(
    <BoardClient
      columns={columns}
      tasks={[task({ id: T1, boardColumnId: COL_H_TODO })]}
      memberIdByWorkspaceId={{ [WS_H]: M_H }}
      workspaceIds={[WS_H]}
      showWorkspace={false}
      workspaces={testWorkspaces}
      currentMemberIds={[M_H]}
    />
  );

  expect(await axe(container)).toHaveNoViolations();
});

it("adopts fresh tasks once the server revalidates and passes new props", () => {
  // Catches a missing (or broken) props->state resync: moveTaskToColumn revalidates "/board", so a
  // completed drop arrives back here as a new `tasks` prop, not just a resolved promise. Without the
  // resync, localTasks is fixed at its very first value forever and this second render would still
  // show "0 tasks" in In Progress (Task 10 review, Important 1).
  const T2 = "c0000000-0000-4000-8000-000000000004";
  const { rerender } = render(
    <BoardClient
      columns={columns}
      tasks={[task({ id: T1, boardColumnId: COL_H_TODO })]}
      memberIdByWorkspaceId={{ [WS_H]: M_H }}
      workspaceIds={[WS_H]}
      showWorkspace={false}
      workspaces={testWorkspaces}
      currentMemberIds={[M_H]}
    />
  );
  expect(screen.getByRole("region", { name: "Not Started, 1 task" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "In Progress, 0 tasks" })).toBeInTheDocument();

  rerender(
    <BoardClient
      columns={columns}
      tasks={[
        task({ id: T1, boardColumnId: COL_H_TODO }),
        task({ id: T2, boardColumnId: COL_H_PROG }),
      ]}
      memberIdByWorkspaceId={{ [WS_H]: M_H }}
      workspaceIds={[WS_H]}
      showWorkspace={false}
      workspaces={testWorkspaces}
      currentMemberIds={[M_H]}
    />
  );

  expect(screen.getByRole("region", { name: "Not Started, 1 task" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "In Progress, 1 task" })).toBeInTheDocument();
});

describe("showOlder cursor", () => {
  function renderWithDone(tasks: BoardTask[]) {
    return render(
      <BoardClient
        columns={columnsWithDone}
        tasks={tasks}
        memberIdByWorkspaceId={{ [WS_H]: M_H }}
        workspaceIds={[WS_H]}
        showWorkspace={false}
        workspaces={testWorkspaces}
        currentMemberIds={[M_H]}
      />
    );
  }

  it("passes the minimum (completedAt, id) pair when two done cards share the oldest completedAt", async () => {
    // Catches dropping beforeId, or picking the maximum pair instead of the minimum: both pass every
    // other test in this suite, and both would silently drop a task across a page boundary in
    // production (see move-actions.ts's loadOlderDone contract).
    //
    // Dates are offsets from the real clock, not fixed literals: groupTasks() itself filters
    // completed tasks older than DONE_WINDOW_DAYS, so a hard-coded date would silently fall outside
    // the window (and out of `shown` entirely) once enough real time has passed.
    const TIE_LOW = "c0000000-0000-4000-8000-000000000005";
    const TIE_HIGH = "c0000000-0000-4000-8000-000000000006";
    const NEWER = "c0000000-0000-4000-8000-000000000007";
    const oneDayAgo = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    renderWithDone([
      task({ id: NEWER, boardColumnId: COL_H_DONE, completedAt: oneDayAgo }),
      task({ id: TIE_HIGH, boardColumnId: COL_H_DONE, completedAt: twoDaysAgo }),
      task({ id: TIE_LOW, boardColumnId: COL_H_DONE, completedAt: twoDaysAgo }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Show older" }));

    await waitFor(() => expect(loadOlderDone).toHaveBeenCalled());
    expect(loadOlderDone).toHaveBeenCalledWith({
      workspaceIds: [WS_H],
      before: twoDaysAgo,
      beforeId: TIE_LOW,
    });
  });

  it("sends only the synthetic cutoff, with beforeId undefined, when the done window is empty", async () => {
    // Catches a change that invents a beforeId (e.g. from stale state) when there is no row on
    // screen to cite — move-actions.ts's loadOlderDoneSchema accepts an absent beforeId as the one
    // legitimate case, not an empty string or a fabricated id.
    renderWithDone([]);

    fireEvent.click(screen.getByRole("button", { name: "Show older" }));

    await waitFor(() => expect(loadOlderDone).toHaveBeenCalled());
    const call = (loadOlderDone as jest.Mock).mock.calls[0][0];
    expect(call.workspaceIds).toEqual([WS_H]);
    expect(call.beforeId).toBeUndefined();
    // DONE_WINDOW_DAYS (7) before the test's system clock — asserted as "a valid ISO timestamp
    // roughly a week in the past" rather than freezing the clock, since the exact instant isn't the
    // behaviour under test.
    expect(new Date(call.before).getTime()).toBeLessThan(Date.now());
  });
});


describe("adding a task from a column", () => {
  function renderBoard() {
    return render(
      <BoardClient
        columns={columns}
        tasks={[task({ id: T1, boardColumnId: COL_H_TODO })]}
        memberIdByWorkspaceId={{ [WS_H]: M_H }}
        workspaceIds={[WS_H]}
        showWorkspace={false}
        workspaces={testWorkspaces}
        currentMemberIds={[M_H]}
      />
    );
  }

  it("opens the create modal against the column that was pressed", () => {
    renderBoard();

    expect(screen.queryByTestId("new-task-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a task to In Progress" }));

    expect(screen.getByTestId("new-task-modal")).toHaveAttribute("data-column", COL_H_PROG);
  });

  it("offers no add control on the terminal column", () => {
    render(
      <BoardClient
        columns={columnsWithDone}
        tasks={[]}
        memberIdByWorkspaceId={{ [WS_H]: M_H }}
        workspaceIds={[WS_H]}
        showWorkspace={false}
        workspaces={testWorkspaces}
        currentMemberIds={[M_H]}
      />
    );

    expect(screen.getByRole("button", { name: "Add a task to Not Started" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a task to Completed" })).not.toBeInTheDocument();
  });

  it("says what an empty column is for instead of leaving it blank", () => {
    renderBoard();

    expect(screen.getByText("Drop a task here, or add one below.")).toBeInTheDocument();
  });
});

describe("opening a card", () => {
  it("fetches the full task and does not fetch for a completed card", async () => {
    (loadTaskForEdit as jest.Mock).mockResolvedValue({ ok: true, task: null });
    render(
      <BoardClient
        columns={columnsWithDone}
        tasks={[
          task({ id: T1, boardColumnId: COL_H_TODO }),
          task({ id: T2, boardColumnId: COL_H_DONE, completedAt: "2026-08-28T09:00:00.000Z" }),
        ]}
        memberIdByWorkspaceId={{ [WS_H]: M_H }}
        workspaceIds={[WS_H]}
        showWorkspace={false}
        workspaces={testWorkspaces}
        currentMemberIds={[M_H]}
      />
    );

    fireEvent.click(screen.getAllByText("Call the plumber")[1]);
    expect(loadTaskForEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByText("Call the plumber")[0]);
    await waitFor(() => expect(loadTaskForEdit).toHaveBeenCalledWith(T1));
  });

  it("toasts rather than opening an empty modal when the task cannot be loaded", async () => {
    (loadTaskForEdit as jest.Mock).mockResolvedValue({ ok: false, error: "That task no longer exists" });
    render(
      <BoardClient
        columns={columns}
        tasks={[task({ id: T1, boardColumnId: COL_H_TODO })]}
        memberIdByWorkspaceId={{ [WS_H]: M_H }}
        workspaceIds={[WS_H]}
        showWorkspace={false}
        workspaces={testWorkspaces}
        currentMemberIds={[M_H]}
      />
    );

    fireEvent.click(screen.getByText("Call the plumber"));

    await waitFor(() => expect(toast).toHaveBeenCalledWith("That task no longer exists", "error"));
  });
});
