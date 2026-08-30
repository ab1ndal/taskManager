jest.mock("@/app/board/actions", () => ({
  renameBoardColumn: jest.fn(),
  setBoardColumnColor: jest.fn(),
}));
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { renameBoardColumn, setBoardColumnColor } from "@/app/board/actions";
import { toast } from "@/components/toaster";
import { ColumnRow } from "./column-row";
import type { BoardColumn } from "@/app/board/group-columns";

const column: BoardColumn = {
  id: "e0000000-0000-4000-8000-00000000000b",
  workspaceId: "a0000000-0000-4000-8000-000000000001",
  name: "In Progress",
  color: "tab20-blue",
  position: 2000,
  isDone: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  (renameBoardColumn as jest.Mock).mockResolvedValue({ ok: true });
  (setBoardColumnColor as jest.Mock).mockResolvedValue({ ok: true });
});

it("saves a rename on blur", async () => {
  render(<ColumnRow column={column} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  const input = screen.getByLabelText("Column name");
  await userEvent.clear(input);
  await userEvent.type(input, "Doing");
  await userEvent.tab();

  expect(renameBoardColumn).toHaveBeenCalledWith({ columnId: column.id, name: "Doing" });
});

it("does not call the server when the name is unchanged", async () => {
  render(<ColumnRow column={column} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  await userEvent.click(screen.getByLabelText("Column name"));
  await userEvent.tab();

  expect(renameBoardColumn).not.toHaveBeenCalled();
});

it("restores the previous name and says so when the rename fails", async () => {
  // Mutation this catches: a rollback that resets state but skips the toast (or vice versa) —
  // both assertions must hold, so dropping either half of the rollback breaks this test.
  (renameBoardColumn as jest.Mock).mockResolvedValue({ ok: false, error: "Name already used" });
  render(<ColumnRow column={column} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  const input = screen.getByLabelText("Column name");
  await userEvent.clear(input);
  await userEvent.type(input, "Blocked");
  await userEvent.tab();

  expect(toast).toHaveBeenCalledWith("Name already used", "error");
  expect(input).toHaveValue("In Progress");
});

it("saves a colour immediately", async () => {
  render(<ColumnRow column={column} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  await userEvent.click(screen.getByRole("radio", { name: "tab20-pink" }));

  expect(setBoardColumnColor).toHaveBeenCalledWith({ columnId: column.id, color: "tab20-pink" });
});

it("restores the previous colour and says so when the colour save fails", async () => {
  // Mutation this catches: a rollback that only toasts without restoring `color` state (or the
  // reverse) — the swatch would silently keep showing the failed colour, or no error would surface.
  (setBoardColumnColor as jest.Mock).mockResolvedValue({ ok: false, error: "Could not change the colour" });
  render(<ColumnRow column={column} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  await userEvent.click(screen.getByRole("radio", { name: "tab20-pink" }));

  expect(toast).toHaveBeenCalledWith("Could not change the colour", "error");
  // Reopen the picker and confirm the original colour is still marked selected.
  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  expect(screen.getByRole("radio", { name: "tab20-blue", checked: true })).toBeInTheDocument();
});

it("says the column is where completed tasks go when it is terminal", () => {
  render(
    <ColumnRow column={{ ...column, isDone: true }} nonTerminalSiblingCount={0} onDeleted={jest.fn()} />
  );

  expect(screen.getByText("Completed tasks land here")).toBeInTheDocument();
});

it("disables delete when it is the workspace's only non-terminal column", () => {
  // Mutation this catches: a guard keyed on total sibling count (the brief's original, wrong,
  // `siblingCount <= 1`) instead of non-terminal sibling count — this fixture has only ONE column
  // total (nonTerminalSiblingCount 0 means no OTHER non-terminal column exists), so a mutant that
  // read `nonTerminalSiblingCount` but compared `< 1` incorrectly, or one that inverted the
  // isDone check, would flip this to enabled.
  render(<ColumnRow column={column} nonTerminalSiblingCount={0} onDeleted={jest.fn()} />);

  expect(screen.getByRole("button", { name: "Delete In Progress" })).toBeDisabled();
});

it("enables delete when another non-terminal column exists", () => {
  // Mutation this catches: a guard that disables whenever nonTerminalSiblingCount is small (e.g.
  // `<= 1` instead of `=== 0`) would wrongly disable this case, where one other non-terminal
  // column exists alongside this one.
  render(<ColumnRow column={column} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  expect(screen.getByRole("button", { name: "Delete In Progress" })).not.toBeDisabled();
});

it("has no accessibility violations, including the disabled-delete guard", async () => {
  // Mutation this catches: an aria-describedby pointing at a missing id, or a disabled control
  // left without an accessible explanation, both of which axe flags as a violation.
  const { container } = render(
    <ul>
      <ColumnRow column={column} nonTerminalSiblingCount={0} onDeleted={jest.fn()} />
    </ul>
  );

  expect(await axe(container)).toHaveNoViolations();
});

it("never disables delete for a terminal column, even with no other non-terminal columns", () => {
  // Mutation this catches: a guard that disables whenever nonTerminalSiblingCount === 0 regardless
  // of isDone would wrongly disable the Done column here, contradicting the server, which never
  // refuses to delete a terminal column on this rule.
  render(
    <ColumnRow column={{ ...column, isDone: true }} nonTerminalSiblingCount={0} onDeleted={jest.fn()} />
  );

  expect(screen.getByRole("button", { name: "Delete In Progress" })).not.toBeDisabled();
});
