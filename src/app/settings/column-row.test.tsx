jest.mock("@/app/board/actions", () => ({
  renameBoardColumn: jest.fn(),
  setBoardColumnColor: jest.fn(),
}));
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { render, screen, waitFor } from "@testing-library/react";
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
  render(<ColumnRow column={column} siblings={[]} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  const input = screen.getByLabelText("Column name");
  await userEvent.clear(input);
  await userEvent.type(input, "Doing");
  await userEvent.tab();

  expect(renameBoardColumn).toHaveBeenCalledWith({ columnId: column.id, name: "Doing" });
});

it("does not call the server when the name is unchanged", async () => {
  render(<ColumnRow column={column} siblings={[]} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  await userEvent.click(screen.getByLabelText("Column name"));
  await userEvent.tab();

  expect(renameBoardColumn).not.toHaveBeenCalled();
});

it("restores the previous name and says so when the rename fails generically", async () => {
  // Mutation this catches: a rollback that resets state but skips the toast (or vice versa) —
  // both assertions must hold, so dropping either half of the rollback breaks this test.
  (renameBoardColumn as jest.Mock).mockResolvedValue({ ok: false, error: "Could not rename the column" });
  render(<ColumnRow column={column} siblings={[]} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  const input = screen.getByLabelText("Column name");
  await userEvent.clear(input);
  await userEvent.type(input, "Blocked");
  await userEvent.tab();

  expect(toast).toHaveBeenCalledWith("Could not rename the column", "error");
  expect(input).toHaveValue("In Progress");
});

it("shows a field-level name error in place, keeps the typed text, and does not toast", async () => {
  // Mutation this catches: routing a `fieldErrors.name` failure through the toast/rollback branch
  // instead of the field-error branch — both the visible error text and "no toast" would fail on a
  // mutant that dropped the `fieldError` check, and a mutant that still rolled back the input would
  // fail the `toHaveValue` assertion.
  (renameBoardColumn as jest.Mock).mockResolvedValue({
    ok: false,
    error: "That name is already used in this workspace",
    fieldErrors: { name: ["That name is already used in this workspace"] },
  });
  render(<ColumnRow column={column} siblings={[]} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  const input = screen.getByLabelText("Column name");
  await userEvent.clear(input);
  await userEvent.type(input, "Blocked");
  await userEvent.tab();

  expect(screen.getByText("That name is already used in this workspace")).toBeInTheDocument();
  expect(toast).not.toHaveBeenCalled();
  expect(input).toHaveValue("Blocked");
  expect(input).toHaveAttribute("aria-invalid", "true");
});

it("does not let a slower failing rename overwrite a faster successful one", async () => {
  // Mutation this catches: rolling back to `column.name` (the prop, frozen at mount) instead of the
  // last value that actually saved. Reproduces the exact race from the finding: an earlier rename
  // is still in flight when a second, faster rename to a different name succeeds; when the first
  // one then resolves as a failure, a rollback keyed off the stale prop would wipe the second
  // rename's already-saved value back to the original "In Progress" — this asserts it survives.
  let resolveFirst!: (value: { ok: boolean; error?: string }) => void;
  (renameBoardColumn as jest.Mock)
    .mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; })
    )
    .mockResolvedValueOnce({ ok: true });

  render(<ColumnRow column={column} siblings={[]} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);
  const input = screen.getByLabelText("Column name");

  await userEvent.clear(input);
  await userEvent.type(input, "First");
  await userEvent.tab(); // fires the first (slow) rename, left pending

  await userEvent.clear(input);
  await userEvent.type(input, "Second");
  await userEvent.tab(); // fires the second (fast) rename, resolves immediately below

  await waitFor(() => expect(renameBoardColumn).toHaveBeenCalledTimes(2));
  expect(input).toHaveValue("Second");

  resolveFirst({ ok: false, error: "Name already used" });
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Name already used", "error"));

  // The stale failure must not have clobbered the newer, already-saved value.
  expect(input).toHaveValue("Second");
});

it("saves a colour immediately", async () => {
  render(<ColumnRow column={column} siblings={[]} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  await userEvent.click(screen.getByRole("radio", { name: "tab20-pink" }));

  expect(setBoardColumnColor).toHaveBeenCalledWith({ columnId: column.id, color: "tab20-pink" });
});

it("restores the previous colour and says so when the colour save fails", async () => {
  // Mutation this catches: a rollback that only toasts without restoring `color` state (or the
  // reverse) — the swatch would silently keep showing the failed colour, or no error would surface.
  (setBoardColumnColor as jest.Mock).mockResolvedValue({ ok: false, error: "Could not change the colour" });
  render(<ColumnRow column={column} siblings={[]} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  await userEvent.click(screen.getByRole("radio", { name: "tab20-pink" }));

  expect(toast).toHaveBeenCalledWith("Could not change the colour", "error");
  // Reopen the picker and confirm the original colour is still marked selected.
  await userEvent.click(screen.getByRole("button", { name: "Colour for In Progress" }));
  expect(screen.getByRole("radio", { name: "tab20-blue", checked: true })).toBeInTheDocument();
});

it("says the column is where completed tasks go when it is terminal", () => {
  render(
    <ColumnRow column={{ ...column, isDone: true }} siblings={[]} nonTerminalSiblingCount={0} onDeleted={jest.fn()} />
  );

  expect(screen.getByText("Completed tasks land here")).toBeInTheDocument();
});

it("disables delete when it is the workspace's only non-terminal column", () => {
  // Mutation this catches: a guard keyed on total sibling count (the brief's original, wrong,
  // `siblingCount <= 1`) instead of non-terminal sibling count — this fixture has only ONE column
  // total (nonTerminalSiblingCount 0 means no OTHER non-terminal column exists), so a mutant that
  // read `nonTerminalSiblingCount` but compared `< 1` incorrectly, or one that inverted the
  // isDone check, would flip this to enabled.
  render(<ColumnRow column={column} siblings={[]} nonTerminalSiblingCount={0} onDeleted={jest.fn()} />);

  expect(screen.getByRole("button", { name: "Delete In Progress" })).toHaveAttribute("aria-disabled", "true");
});

it("enables delete when another non-terminal column exists", () => {
  // Mutation this catches: a guard that disables whenever nonTerminalSiblingCount is small (e.g.
  // `<= 1` instead of `=== 0`) would wrongly disable this case, where one other non-terminal
  // column exists alongside this one.
  render(<ColumnRow column={column} siblings={[]} nonTerminalSiblingCount={1} onDeleted={jest.fn()} />);

  expect(screen.getByRole("button", { name: "Delete In Progress" })).not.toHaveAttribute("aria-disabled");
});

it("keeps the guarded delete button focusable and announces why, unlike a real disabled control", async () => {
  // Mutation this catches: reverting to the `disabled` attribute — a disabled button cannot
  // receive focus via Tab, so the `tab()` navigation below would land somewhere else and the
  // `toHaveFocus` assertion would fail; the `aria-describedby` id must also resolve to real,
  // rendered text (an axe check alone can't tell the tooltip/description are actually reachable).
  render(<ColumnRow column={column} siblings={[]} nonTerminalSiblingCount={0} onDeleted={jest.fn()} />);

  const deleteButton = screen.getByRole("button", { name: "Delete In Progress" });
  const input = screen.getByLabelText("Column name");
  input.focus();
  await userEvent.tab(); // color picker sits before the name input in DOM order... tab from name goes to delete
  expect(deleteButton).toHaveFocus();

  const describedById = deleteButton.getAttribute("aria-describedby");
  expect(describedById).toBeTruthy();
  expect(document.getElementById(describedById!)).toHaveTextContent(
    "A workspace needs at least one active column, so this cannot be deleted."
  );

  await userEvent.click(deleteButton);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("has no accessibility violations, including the disabled-delete guard", async () => {
  // Mutation this catches: an aria-describedby pointing at a missing id, or a disabled control
  // left without an accessible explanation, both of which axe flags as a violation.
  const { container } = render(
    <ul>
      <ColumnRow column={column} siblings={[]} nonTerminalSiblingCount={0} onDeleted={jest.fn()} />
    </ul>
  );

  expect(await axe(container)).toHaveNoViolations();
});

it("never disables delete for a terminal column, even with no other non-terminal columns", () => {
  // Mutation this catches: a guard that disables whenever nonTerminalSiblingCount === 0 regardless
  // of isDone would wrongly disable the Done column here, contradicting the server, which never
  // refuses to delete a terminal column on this rule.
  render(
    <ColumnRow column={{ ...column, isDone: true }} siblings={[]} nonTerminalSiblingCount={0} onDeleted={jest.fn()} />
  );

  expect(screen.getByRole("button", { name: "Delete In Progress" })).not.toHaveAttribute("aria-disabled");
});
