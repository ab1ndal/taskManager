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
