jest.mock("@/app/board/actions", () => ({
  listTasksInColumn: jest.fn(),
  deleteBoardColumn: jest.fn(),
}));
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

// jsdom does not implement showModal(); stub it so Dialog's mount effect doesn't throw, and set
// the `open` attribute so testing-library's accessibility tree treats dialog content as visible.
HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { deleteBoardColumn, listTasksInColumn } from "@/app/board/actions";
import { toast } from "@/components/toaster";
import { DeleteColumnDialog } from "./delete-column-dialog";
import type { BoardColumn } from "@/app/board/group-columns";

const WS = "a0000000-0000-4000-8000-000000000001";
const COL_A = "e0000000-0000-4000-8000-00000000000a";
const COL_B = "e0000000-0000-4000-8000-00000000000b";
const COL_DONE = "e0000000-0000-4000-8000-00000000000d";
const T1 = "c0000000-0000-4000-8000-000000000001";
const T2 = "c0000000-0000-4000-8000-000000000002";

function column(overrides: Partial<BoardColumn> & { id: string; name: string }): BoardColumn {
  return { workspaceId: WS, color: "tab20-blue", position: 1000, isDone: false, ...overrides };
}

const blocked = column({ id: COL_A, name: "Blocked", color: "tab20-red", position: 2000 });
const siblings = [
  column({ id: COL_B, name: "In Progress", position: 1000 }),
  column({ id: COL_DONE, name: "Completed", position: 3000, isDone: true, color: "tab20-green" }),
];

beforeEach(() => {
  jest.clearAllMocks();
  (deleteBoardColumn as jest.Mock).mockResolvedValue({ ok: true });
  (listTasksInColumn as jest.Mock).mockResolvedValue({
    ok: true,
    tasks: [
      { id: T1, title: "Call the plumber", completedAt: null },
      { id: T2, title: "Fix the garage light", completedAt: null },
    ],
  });
});

function open() {
  return render(
    <DeleteColumnDialog
      column={blocked}
      siblings={siblings}
      onClose={jest.fn()}
      onDeleted={jest.fn()}
    />
  );
}

it("lists every task in the column with its own destination select", async () => {
  open();

  expect(await screen.findByText("Call the plumber")).toBeInTheDocument();
  expect(screen.getByText("Fix the garage light")).toBeInTheDocument();
  expect(screen.getByLabelText("Move Call the plumber to")).toBeInTheDocument();
  expect(screen.getByLabelText("Move Fix the garage light to")).toBeInTheDocument();
});

it("defaults every destination to the deleted column's left neighbour", async () => {
  open();

  await waitFor(() => expect(screen.getByLabelText("Move Call the plumber to")).toHaveValue(COL_B));
  expect(screen.getByLabelText("Move Fix the garage light to")).toHaveValue(COL_B);
});

it("defaults to the right neighbour when deleting the leftmost column", async () => {
  render(
    <DeleteColumnDialog
      column={column({ id: COL_A, name: "Blocked", position: 500 })}
      siblings={siblings}
      onClose={jest.fn()}
      onDeleted={jest.fn()}
    />
  );

  await waitFor(() => expect(screen.getByLabelText("Move Call the plumber to")).toHaveValue(COL_B));
});

it("sends one move per task, using each row's own choice", async () => {
  open();
  await screen.findByText("Call the plumber");

  await userEvent.selectOptions(screen.getByLabelText("Move Fix the garage light to"), COL_DONE);
  await userEvent.click(screen.getByRole("button", { name: "Delete column" }));

  expect(deleteBoardColumn).toHaveBeenCalledWith({
    columnId: COL_A,
    moves: [
      { taskId: T1, targetColumnId: COL_B },
      { taskId: T2, targetColumnId: COL_DONE },
    ],
  });
});

it("sets every row at once from the move-all control", async () => {
  open();
  await screen.findByText("Call the plumber");

  await userEvent.selectOptions(screen.getByLabelText("Move all tasks to"), COL_DONE);

  expect(screen.getByLabelText("Move Call the plumber to")).toHaveValue(COL_DONE);
  expect(screen.getByLabelText("Move Fix the garage light to")).toHaveValue(COL_DONE);
});

it("skips the list for an empty column and still confirms", async () => {
  (listTasksInColumn as jest.Mock).mockResolvedValue({ ok: true, tasks: [] });
  open();

  expect(await screen.findByText("This column is empty.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Move all tasks to")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Delete column" }));

  expect(deleteBoardColumn).toHaveBeenCalledWith({ columnId: COL_A, moves: [] });
});

it("warns that completed tasks will vanish when deleting the terminal column", async () => {
  render(
    <DeleteColumnDialog
      column={column({ id: COL_DONE, name: "Completed", isDone: true })}
      siblings={[blocked, column({ id: COL_B, name: "In Progress" })]}
      onClose={jest.fn()}
      onDeleted={jest.fn()}
    />
  );

  expect(
    await screen.findByText(/completed tasks will no longer appear on the board/i)
  ).toBeInTheDocument();
});

it("reloads the list instead of deleting when the column changed underneath", async () => {
  (deleteBoardColumn as jest.Mock).mockResolvedValue({
    ok: false,
    error: "column changed since it was listed",
  });
  const onDeleted = jest.fn();
  render(
    <DeleteColumnDialog column={blocked} siblings={siblings} onClose={jest.fn()} onDeleted={onDeleted} />
  );
  await screen.findByText("Call the plumber");

  await userEvent.click(screen.getByRole("button", { name: "Delete column" }));

  expect(onDeleted).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith("This column changed — check the list and try again.", "error");
  expect(listTasksInColumn).toHaveBeenCalledTimes(2);
});

it("closes on cancel without deleting", async () => {
  const onClose = jest.fn();
  render(
    <DeleteColumnDialog column={blocked} siblings={siblings} onClose={onClose} onDeleted={jest.fn()} />
  );
  await screen.findByText("Call the plumber");

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onClose).toHaveBeenCalled();
  expect(deleteBoardColumn).not.toHaveBeenCalled();
});

it("has no accessibility violations", async () => {
  const { container } = open();
  await screen.findByText("Call the plumber");

  expect(await axe(container)).toHaveNoViolations();
});

// A promise whose resolution the test controls, so two loads can be put in flight and resolved out
// of order.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const listOf = (...titles: string[]) => ({
  ok: true,
  tasks: titles.map((title, index) => ({ id: `${T1.slice(0, -1)}${index}`, title, completedAt: null })),
});

it("discards a load that resolves after the dialog unmounts", async () => {
  const pending = deferred<{ ok: boolean; error?: string }>();
  (listTasksInColumn as jest.Mock).mockReturnValue(pending.promise);
  const onClose = jest.fn();

  const { unmount } = render(
    <DeleteColumnDialog column={blocked} siblings={siblings} onClose={onClose} onDeleted={jest.fn()} />
  );
  unmount();

  await act(async () => {
    pending.resolve({ ok: false, error: "boom" });
  });

  expect(onClose).not.toHaveBeenCalled();
  expect(toast).not.toHaveBeenCalled();
});

it("keeps the newer list when an older load resolves last", async () => {
  const first = deferred<ReturnType<typeof listOf>>();
  const second = deferred<ReturnType<typeof listOf>>();
  (listTasksInColumn as jest.Mock)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);

  const { rerender } = render(
    <DeleteColumnDialog column={blocked} siblings={siblings} onClose={jest.fn()} onDeleted={jest.fn()} />
  );

  // A new onClose identity re-runs the load effect, retiring the first request mid-flight.
  rerender(
    <DeleteColumnDialog column={blocked} siblings={siblings} onClose={jest.fn()} onDeleted={jest.fn()} />
  );
  expect(listTasksInColumn).toHaveBeenCalledTimes(2);

  await act(async () => {
    second.resolve(listOf("Second response"));
  });
  await act(async () => {
    first.resolve(listOf("First response"));
  });

  expect(screen.getByText("Second response")).toBeInTheDocument();
  expect(screen.queryByText("First response")).not.toBeInTheDocument();
});

it("keeps the confirm button disabled while the stale-list reload is in flight", async () => {
  (deleteBoardColumn as jest.Mock).mockResolvedValue({
    ok: false,
    error: "column changed since it was listed",
  });
  const reload = deferred<ReturnType<typeof listOf>>();
  (listTasksInColumn as jest.Mock)
    .mockResolvedValueOnce(listOf("Call the plumber"))
    .mockReturnValueOnce(reload.promise);

  render(
    <DeleteColumnDialog column={blocked} siblings={siblings} onClose={jest.fn()} onDeleted={jest.fn()} />
  );
  await screen.findByText("Call the plumber");

  await userEvent.click(screen.getByRole("button", { name: "Delete column" }));

  await waitFor(() => expect(listTasksInColumn).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: "Delete column" })).toBeDisabled();

  await act(async () => {
    reload.resolve(listOf("Reloaded task"));
  });

  expect(screen.getByRole("button", { name: "Delete column" })).toBeEnabled();
});
