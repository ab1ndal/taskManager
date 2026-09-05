jest.mock("./move-actions", () => ({ moveTaskToColumn: jest.fn() }));

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MoveTaskDialog } from "./move-task-dialog";
import { moveTaskToColumn } from "./move-actions";
import type { BoardColumn, BoardTask } from "./group-columns";

const columns: BoardColumn[] = [
  { id: "open", workspaceId: "workspace", name: "Not Started", color: "tab20-blue", position: 1000, isDone: false },
  { id: "done", workspaceId: "workspace", name: "Completed", color: "tab20-green", position: 2000, isDone: true },
];
const task: BoardTask = {
  id: "task", title: "Call the plumber", workspaceId: "workspace", workspaceName: "Household",
  workspaceKind: "household", boardColumnId: "open", completedAt: null, dueAt: null,
  memberSortKey: 1000, assigneeCount: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});

it("moves through the shared action, preserves priority and closes only after success", async () => {
  const onClose = jest.fn();
  (moveTaskToColumn as jest.Mock).mockResolvedValue({ ok: true });
  const { container } = render(<MoveTaskDialog task={task} columns={columns} memberId="member" onClose={onClose} />);
  expect(screen.getByRole("button", { name: "Move task" })).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText("Move to column"), "done");
  expect(screen.getByText(/completes the task and its subtasks/)).toBeInTheDocument();
  expect(await axe(container)).toHaveNoViolations();
  await userEvent.click(screen.getByRole("button", { name: "Move task" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(moveTaskToColumn).toHaveBeenCalledWith({ taskId: "task", columnId: "done", memberId: "member", prevKey: null, nextKey: null });
});

it("uses the displayed completed column and explains reopening", async () => {
  render(<MoveTaskDialog task={{ ...task, completedAt: new Date().toISOString() }} columns={columns} memberId="member" onClose={jest.fn()} />);
  expect(screen.getByLabelText("Move to column")).toHaveValue("done");
  await userEvent.selectOptions(screen.getByLabelText("Move to column"), "open");
  expect(screen.getByText(/This reopens the task/)).toBeInTheDocument();
});

it.each([false, true])("keeps failures inside the dialog so a retry is possible (network failure: %s)", async (networkFailure) => {
  const onClose = jest.fn();
  const action = moveTaskToColumn as jest.Mock;
  if (networkFailure) action.mockRejectedValue(new Error("connection closed"));
  else action.mockResolvedValue({ ok: false, error: "That column no longer exists" });
  render(<MoveTaskDialog task={task} columns={columns} memberId="member" onClose={onClose} />);
  await userEvent.selectOptions(screen.getByLabelText("Move to column"), "done");
  await userEvent.click(screen.getByRole("button", { name: "Move task" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(networkFailure ? "Could not move" : "That column no longer exists");
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Move task" })).toBeEnabled();
});
