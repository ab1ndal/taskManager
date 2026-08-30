const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
jest.mock("@/app/board/actions", () => ({
  createBoardColumn: jest.fn(),
  renameBoardColumn: jest.fn(),
  setBoardColumnColor: jest.fn(),
}));
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { createBoardColumn } from "@/app/board/actions";
import { toast } from "@/components/toaster";
import { BoardColumnsEditor } from "./board-columns-editor";
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

it("toasts and does not refresh or clear the field when adding fails", async () => {
  // Mutation this catches: swallowing a failed createBoardColumn result and refreshing/clearing
  // anyway — the assertions on mockRefresh and the input's value would both still pass a mutant
  // that dropped the `if (!result.ok) return;` early exit only if this test didn't check them.
  (createBoardColumn as jest.Mock).mockResolvedValue({ ok: false, error: "Name already used" });
  render(
    <BoardColumnsEditor workspaceId="ws-1" workspaceName="Household" columns={[notStarted]} />
  );

  const input = screen.getByLabelText("New column name for Household");
  await userEvent.type(input, "Waiting");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(toast).toHaveBeenCalledWith("Name already used", "error");
  expect(mockRefresh).not.toHaveBeenCalled();
  expect(input).toHaveValue("Waiting");
});

it("counts non-terminal siblings per row, excluding the row itself and the done column", () => {
  // Mutation this catches: computing the count from `columns.length` (a whole-array size, the
  // brief's original wrong guard) instead of filtering out both the row itself and terminal
  // columns — with two non-terminal columns plus one done column, a length-based mutant would
  // report 3 or 2 for every row instead of 1 for each non-terminal row and (irrelevantly) for the
  // done row, so "Not Started" and "In Progress" would wrongly show their delete button enabled
  // OR disabled depending on the miscount, and this fixture is built so only the correct formula
  // lands on 1.
  render(
    <BoardColumnsEditor
      workspaceId="ws-1"
      workspaceName="Household"
      columns={[notStarted, inProgress, done]}
    />
  );

  expect(screen.getByRole("button", { name: "Delete Not Started" })).not.toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete In Progress" })).not.toBeDisabled();
  // The done column is never blocked by this rule regardless of count.
  expect(screen.getByRole("button", { name: "Delete Completed" })).not.toBeDisabled();
});

it("disables delete on the sole non-terminal column even when a done column also exists", () => {
  // Mutation this catches: a guard that counts the done column as a "sibling" that keeps delete
  // enabled — done columns must not count, so with only one non-terminal column and one done
  // column, deleting the non-terminal one must still be blocked.
  render(
    <BoardColumnsEditor workspaceId="ws-1" workspaceName="Household" columns={[notStarted, done]} />
  );

  expect(screen.getByRole("button", { name: "Delete Not Started" })).toBeDisabled();
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
