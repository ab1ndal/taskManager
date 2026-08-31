const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
jest.mock("@/app/board/actions", () => ({
  createBoardColumn: jest.fn(),
  renameBoardColumn: jest.fn(),
  setBoardColumnColor: jest.fn(),
  reorderBoardColumn: jest.fn(),
}));
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { createBoardColumn, reorderBoardColumn } from "@/app/board/actions";
import { toast } from "@/components/toaster";
import { BoardColumnsEditor, buildColumnDragEndHandler } from "./board-columns-editor";
import type { BoardColumn } from "@/app/board/group-columns";

const notStarted: BoardColumn = {
  id: "e0000000-0000-4000-8000-000000000001",
  workspaceId: "a0000000-0000-4000-8000-000000000001",
  name: "Not Started",
  color: "tab20-grey",
  position: 1000,
  isDone: false,
};
const inProgress: BoardColumn = {
  ...notStarted,
  id: "e0000000-0000-4000-8000-000000000002",
  name: "In Progress",
  color: "tab20-blue",
  position: 2000,
};
const done: BoardColumn = {
  ...notStarted,
  id: "e0000000-0000-4000-8000-000000000003",
  name: "Completed",
  color: "tab20-green",
  position: 3000,
  isDone: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  (createBoardColumn as jest.Mock).mockResolvedValue({ ok: true, columnId: "new-id" });
  (reorderBoardColumn as jest.Mock).mockResolvedValue({ ok: true });
});

it("submits the trimmed name with a neutral default colour, then refreshes and clears the field", async () => {
  render(
    <BoardColumnsEditor workspaceId="ws-1" workspaceName="Household" columns={[notStarted]} />
  );

  const input = screen.getByLabelText("New column name for Household");
  await userEvent.type(input, "  Waiting  ");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(createBoardColumn).toHaveBeenCalledWith({
    workspaceId: "ws-1",
    name: "Waiting",
    color: "tab20-grey",
  });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(input).toHaveValue("");
});

it("does not submit a blank name", async () => {
  render(<BoardColumnsEditor workspaceId="ws-1" workspaceName="Household" columns={[]} />);

  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  expect(createBoardColumn).not.toHaveBeenCalled();
});

it("toasts and does not refresh or clear the field when adding fails generically", async () => {
  // Mutation this catches: swallowing a failed createBoardColumn result and refreshing/clearing
  // anyway — the assertions on mockRefresh and the input's value would both still pass a mutant
  // that dropped the `if (!result.ok) return;` early exit only if this test didn't check them.
  (createBoardColumn as jest.Mock).mockResolvedValue({ ok: false, error: "Something went wrong" });
  render(
    <BoardColumnsEditor workspaceId="ws-1" workspaceName="Household" columns={[notStarted]} />
  );

  const input = screen.getByLabelText("New column name for Household");
  await userEvent.type(input, "Waiting");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(toast).toHaveBeenCalledWith("Something went wrong", "error");
  expect(mockRefresh).not.toHaveBeenCalled();
  expect(input).toHaveValue("Waiting");
});

it("shows a field-level error and keeps the typed name on a name collision, without a toast", async () => {
  // Mutation this catches: routing a `fieldErrors.name` failure through the generic toast branch
  // instead of the field-error branch — the toast assertion (`not.toHaveBeenCalled`) and the
  // on-screen error text would both fail on a mutant that dropped the `fieldError` check.
  (createBoardColumn as jest.Mock).mockResolvedValue({
    ok: false,
    error: "That name is already used in this workspace",
    fieldErrors: { name: ["That name is already used in this workspace"] },
  });
  render(
    <BoardColumnsEditor workspaceId="ws-1" workspaceName="Household" columns={[notStarted]} />
  );

  const input = screen.getByLabelText("New column name for Household");
  await userEvent.type(input, "Not Started");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(screen.getByText("That name is already used in this workspace")).toBeInTheDocument();
  expect(toast).not.toHaveBeenCalled();
  expect(input).toHaveValue("Not Started");
  expect(mockRefresh).not.toHaveBeenCalled();
});

it("keeps non-terminal columns' delete enabled when a sibling exists, and the done column always enabled", () => {
  // This checks the happy-path outcome only: a `columns.length`-based miscount would also leave
  // every button here enabled (three columns total is still nonzero for every row), so it cannot
  // by itself distinguish the correct exclude-self-and-done formula from that bug — the sole-column
  // case below is what actually catches it.
  render(
    <BoardColumnsEditor
      workspaceId="ws-1"
      workspaceName="Household"
      columns={[notStarted, inProgress, done]}
    />
  );

  expect(screen.getByRole("button", { name: "Delete Not Started" })).not.toHaveAttribute("aria-disabled");
  expect(screen.getByRole("button", { name: "Delete In Progress" })).not.toHaveAttribute("aria-disabled");
  expect(screen.getByRole("button", { name: "Delete Completed" })).not.toHaveAttribute("aria-disabled");
});

it("disables delete on the sole non-terminal column even when a done column also exists", () => {
  // Mutation this catches: a guard that counts the done column as a countable sibling, or one
  // computed from `columns.length` without excluding self/done — either way count would be nonzero
  // here (2 total columns), so delete would wrongly stay enabled instead of guarded.
  render(
    <BoardColumnsEditor workspaceId="ws-1" workspaceName="Household" columns={[notStarted, done]} />
  );

  expect(screen.getByRole("button", { name: "Delete Not Started" })).toHaveAttribute("aria-disabled", "true");
});

it("treats a guarded delete click as a no-op instead of opening the dialog", async () => {
  // Mutation this catches: using the disabled attribute (or omitting the onClick guard) — with
  // aria-disabled + a no-op handler, a click must not flip `confirmingDelete`, which this proves by
  // asserting the dialog's own content never appears. A regression back to a real `disabled`
  // attribute would still pass this particular click assertion, which is why Important-3's fix is
  // also checked directly against the button's attributes in the sibling test above.
  render(
    <BoardColumnsEditor workspaceId="ws-1" workspaceName="Household" columns={[notStarted, done]} />
  );

  const deleteButton = screen.getByRole("button", { name: "Delete Not Started" });
  await userEvent.click(deleteButton);

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("has no accessibility violations", async () => {
  const { container } = render(
    <BoardColumnsEditor
      workspaceId="ws-1"
      workspaceName="Household"
      columns={[notStarted, inProgress, done]}
    />
  );

  expect(await axe(container)).toHaveNoViolations();
});

describe("reordering", () => {
  const columns = [notStarted, inProgress, done];

  /** The shape @hello-pangea/dnd hands onDragEnd; only these fields are read. */
  function drop(draggableId: string, from: number, to: number) {
    return {
      draggableId,
      source: { droppableId: "columns-ws", index: from },
      destination: { droppableId: "columns-ws", index: to },
    } as never;
  }

  function handlerOver(list: BoardColumn[]) {
    let state = list;
    const setColumns = (updater: (prev: BoardColumn[]) => BoardColumn[]) => {
      state = updater(state);
    };
    const onError = jest.fn();
    const run = buildColumnDragEndHandler({ columns: list, setColumns, onError });
    return { run, onError, names: () => state.map((c) => c.name), state: () => state };
  }

  it("gives every row a drag handle", () => {
    render(
      <BoardColumnsEditor workspaceId="ws" workspaceName="Household" columns={columns} />
    );

    for (const name of ["Not Started", "In Progress", "Completed"]) {
      expect(screen.getByRole("button", { name: `Reorder "${name}"` })).toBeInTheDocument();
    }
  });

  it("sends the positions either side of the drop and moves the row optimistically", async () => {
    // Mutation this catches: sending the dragged column's own neighbours from before the drop
    // (1000/3000 here) instead of the neighbours it lands between — the row would snap back.
    const { run, names } = handlerOver(columns);

    await run(drop(done.id, 2, 0));

    expect(reorderBoardColumn).toHaveBeenCalledWith({
      columnId: done.id,
      prevPosition: null,
      nextPosition: 1000,
    });
    expect(names()).toEqual(["Completed", "Not Started", "In Progress"]);
  });

  it("passes a null nextPosition when dropped at the end", () => {
    // Mutation this catches: reading the neighbour off the pre-drop array, where index 2 still
    // exists, so the last slot would wrongly report a next neighbour. The prev neighbour is the
    // done column (3000) because the dragged row is removed before the insert index is applied.
    const { run } = handlerOver(columns);

    void run(drop(notStarted.id, 0, 2));

    expect(reorderBoardColumn).toHaveBeenCalledWith({
      columnId: notStarted.id,
      prevPosition: 3000,
      nextPosition: null,
    });
  });

  it("rolls the moved column back and toasts when the write fails", async () => {
    // Mutation this catches: dropping the rollback branch — the list would keep an order the server
    // refused, and the next revalidation would silently undo it with no explanation.
    (reorderBoardColumn as jest.Mock).mockResolvedValue({ ok: false, error: "nope" });
    const { run, onError, names } = handlerOver(columns);

    await run(drop(done.id, 2, 0));

    expect(names()).toEqual(["Not Started", "In Progress", "Completed"]);
    expect(onError).toHaveBeenCalledWith("nope");
  });

  it("does not write when the drop lands where the column already was", async () => {
    const { run } = handlerOver(columns);

    await run(drop(inProgress.id, 1, 1));
    await run({ draggableId: inProgress.id, source: { index: 1 }, destination: null } as never);

    expect(reorderBoardColumn).not.toHaveBeenCalled();
  });

  it("leaves a sole column alone: there is nothing to order it against", async () => {
    const { run } = handlerOver([notStarted]);

    await run(drop(notStarted.id, 0, 0));

    expect(reorderBoardColumn).not.toHaveBeenCalled();
  });
});
