jest.mock("./actions", () => ({
  updateTask: jest.fn(),
  getTaskUpdates: jest.fn(),
  addTaskUpdate: jest.fn(),
  addSubtask: jest.fn(),
}));
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditTaskModal } from "./edit-task-modal";
import { updateTask, getTaskUpdates, addTaskUpdate, addSubtask } from "./actions";
import type { RawTask } from "./bucket-tasks";

beforeAll(() => {
  // jsdom does not implement showModal(); mock it so Dialog's mount effect doesn't throw, and set
  // the `open` attribute so testing-library's accessibility tree treats dialog content as visible.
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

const mockTask: RawTask = {
  id: "c0000000-0000-4000-8000-000000000001",
  title: "Buy groceries",
  description: "Milk and eggs",
  due_at: "2026-04-10T00:00:00Z",
  completed_at: null,
  workspace: { id: "a0000000-0000-4000-8000-000000000001", name: "Home", kind: "household" },
  member_sort_key: 1000,
  assignee_count: 1,
  member_ids: ["b0000000-0000-4000-8000-000000000001"],
  subtasks: [],
};

const mockWs = { id: "a0000000-0000-4000-8000-000000000001", name: "Home", kind: "household", members: [{ id: "b0000000-0000-4000-8000-000000000001", display_name: "Alice" }] };

beforeEach(() => {
  // Every render of the modal fires the Updates-loading effect; default it to an empty list so
  // tests unrelated to Updates don't have to stub it themselves.
  jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
});

describe("EditTaskModal", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders with task values pre-filled", () => {
    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );
    expect(screen.getByDisplayValue("Buy groceries")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Milk and eggs")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-04-10")).toBeInTheDocument();
  });

  it("calls updateTask with updated values on submit", async () => {
    const mock = jest.mocked(updateTask);
    mock.mockResolvedValue({ ok: true });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    const titleInput = screen.getByDisplayValue("Buy groceries");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Buy more groceries");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "c0000000-0000-4000-8000-000000000001", title: "Buy more groceries" })
      );
    });
  });

  it("calls onClose after successful save", async () => {
    const mock = jest.mocked(updateTask);
    mock.mockResolvedValue({ ok: true });
    const onClose = jest.fn();

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={onClose} />
    );

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // Client-side schema failures show inline in the still-open dialog rather than a toast: a
  // fixed-position toast is inert while a native <dialog> is showModal()-open (everything else in
  // the document is made inert, popovers included), so its dismiss button would be unreachable.
  it("shows a validation failure inline instead of toasting, and does not close the dialog", async () => {
    const mock = jest.mocked(updateTask);
    const onClose = jest.fn();

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={onClose} />
    );

    const titleInput = screen.getByDisplayValue("Buy groceries");
    await userEvent.clear(titleInput);
    fireEvent.change(titleInput, { target: { value: "x".repeat(201) } });
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/200 characters or fewer/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(mock).not.toHaveBeenCalled();
  });

  it("does not render when open is false", () => {
    render(
      <EditTaskModal open={false} task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );
    expect(screen.queryByDisplayValue("Buy groceries")).not.toBeInTheDocument();
  });
});

// ─── Dialog primitive behavior ────────────────────────────────────────────────

describe("EditTaskModal — Dialog primitive", () => {
  beforeEach(() => jest.clearAllMocks());

  it("focuses the title input when the modal opens, without user interaction", () => {
    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );
    expect(screen.getByDisplayValue("Buy groceries")).toHaveFocus();
  });

  it("pressing Escape calls the same onClose Cancel calls", () => {
    const onClose = jest.fn();
    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={onClose} />
    );
    const dialogEl = screen.getByRole("dialog", { hidden: true });
    fireEvent(dialogEl, new Event("close"));
    expect(onClose).toHaveBeenCalled();
  });
});

// ─── Updates section ──────────────────────────────────────────────────────────

describe("EditTaskModal — Updates", () => {
  beforeEach(() => jest.clearAllMocks());

  it("loads and shows existing updates when opened", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({
      ok: true,
      updates: [
        { id: "u1", authorName: "Alice", createdAt: "2026-07-26T09:00:00Z", updateText: "First update" },
      ],
    });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    const updateItem = (await screen.findByText("First update")).closest("li")!;
    expect(within(updateItem).getByText("Alice")).toBeInTheDocument();
  });

  it("optimistically appends a new update and calls addTaskUpdate", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
    jest.mocked(addTaskUpdate).mockResolvedValue({
      ok: true,
      update: { id: "u2", authorName: "Alice", createdAt: "2026-07-26T11:00:00Z", updateText: "Picked it up" },
    });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    await screen.findByPlaceholderText(/add an update/i);
    await userEvent.type(screen.getByPlaceholderText(/add an update/i), "Picked it up");
    await userEvent.click(screen.getByRole("button", { name: /^add update$/i }));

    expect(await screen.findByText("Picked it up")).toBeInTheDocument();
    expect(addTaskUpdate).toHaveBeenCalledWith({ taskId: mockTask.id, updateText: "Picked it up" });
  });

  it("rolls back the optimistic update and shows an inline error on failure", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
    jest.mocked(addTaskUpdate).mockResolvedValue({ ok: false, error: "Something went wrong" });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    await screen.findByPlaceholderText(/add an update/i);
    await userEvent.type(screen.getByPlaceholderText(/add an update/i), "Will fail");
    await userEvent.click(screen.getByRole("button", { name: /^add update$/i }));

    await screen.findByText("Something went wrong");
    expect(screen.queryByText("Will fail")).not.toBeInTheDocument();
  });

  it("does not render a mic button when SpeechRecognition is unsupported", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    await screen.findByPlaceholderText(/add an update/i);
    expect(screen.queryByRole("button", { name: /dictate/i })).not.toBeInTheDocument();
  });
});

// ─── Subtasks section ─────────────────────────────────────────────────────────

describe("EditTaskModal — Subtasks", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows existing subtasks from the task prop", () => {
    const taskWithSubtasks = { ...mockTask, subtasks: [{ id: "s1", title: "Existing subtask", completed_at: null }] };
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });

    render(
      <EditTaskModal open task={taskWithSubtasks} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    expect(screen.getByText("Existing subtask")).toBeInTheDocument();
  });

  it("optimistically appends a new subtask and calls addSubtask", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
    jest.mocked(addSubtask).mockResolvedValue({ ok: true, subtask: { id: "s2", title: "New subtask", completed_at: null } });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    await userEvent.type(screen.getByPlaceholderText(/new subtask title/i), "New subtask");
    await userEvent.click(screen.getByRole("button", { name: /^add subtask$/i }));

    expect(await screen.findByText("New subtask")).toBeInTheDocument();
    expect(addSubtask).toHaveBeenCalledWith(
      expect.objectContaining({ parentTaskId: mockTask.id, title: "New subtask" })
    );
  });

  it("rolls back the optimistic subtask and shows an inline error on failure", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
    jest.mocked(addSubtask).mockResolvedValue({ ok: false, error: "Something went wrong" });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} currentMemberIds={["b0000000-0000-4000-8000-000000000001"]} onClose={() => {}} />
    );

    await userEvent.type(screen.getByPlaceholderText(/new subtask title/i), "Will fail");
    await userEvent.click(screen.getByRole("button", { name: /^add subtask$/i }));

    await screen.findByText("Something went wrong");
    expect(screen.queryByText("Will fail")).not.toBeInTheDocument();
  });
});
