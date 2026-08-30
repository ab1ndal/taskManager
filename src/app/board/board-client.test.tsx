jest.mock("./move-actions", () => ({ moveTaskToColumn: jest.fn(), loadOlderDone: jest.fn() }));

import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { DropResult } from "@hello-pangea/dnd";

import { BoardClient, buildBoardDragEndHandler } from "./board-client";
import { mergeColumns, type BoardColumn, type BoardTask } from "./group-columns";
import { moveTaskToColumn } from "./move-actions";

const WS_H = "a0000000-0000-4000-8000-000000000001";
const WS_W = "a0000000-0000-4000-8000-000000000002";
const M_H = "b0000000-0000-4000-8000-000000000001";
const COL_H_TODO = "e0000000-0000-4000-8000-00000000000a";
const COL_H_PROG = "e0000000-0000-4000-8000-00000000000b";
const T1 = "c0000000-0000-4000-8000-000000000001";

beforeEach(() => {
  jest.clearAllMocks();
  (moveTaskToColumn as jest.Mock).mockResolvedValue({ ok: true });
});

const columns: BoardColumn[] = [
  { id: COL_H_TODO, workspaceId: WS_H, name: "Not Started", color: "tab20-grey", position: 1000, isDone: false },
  { id: COL_H_PROG, workspaceId: WS_H, name: "In Progress", color: "tab20-blue", position: 2000, isDone: false },
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

  await handler({ setLocalTasks, onError })(drop({}));

  // Once to move it, once to put it back.
  expect(setLocalTasks).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledWith("Nope");

  const applyFirst = setLocalTasks.mock.calls[0][0] as (prev: BoardTask[]) => BoardTask[];
  expect(applyFirst([task({ id: T1, boardColumnId: COL_H_TODO })])[0].boardColumnId).toBe(COL_H_PROG);

  const applyRollback = setLocalTasks.mock.calls[1][0] as (prev: BoardTask[]) => BoardTask[];
  expect(applyRollback([task({ id: T1, boardColumnId: COL_H_PROG })])[0].boardColumnId).toBe(COL_H_TODO);
});

it("renders one region per column, labelled with its task count", () => {
  render(
    <BoardClient
      columns={columns}
      tasks={[task({ id: T1, boardColumnId: COL_H_TODO })]}
      memberIdByWorkspaceId={{ [WS_H]: M_H }}
      workspaceIds={[WS_H]}
      showWorkspace={false}
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
    />
  );

  expect(await axe(container)).toHaveNoViolations();
});
