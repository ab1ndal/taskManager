jest.mock("./actions", () => ({
  updateTask: jest.fn(),
  getTaskUpdates: jest.fn(),
  addTaskUpdate: jest.fn(),
  addSubtask: jest.fn(),
  updateSubtask: jest.fn(),
  completeTask: jest.fn(),
  reopenTask: jest.fn(),
  deleteTask: jest.fn(),
}));
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

import React from "react";
import { render, screen, waitFor, fireEvent, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditTaskModal, formatUpdateTime, formatUpdateTimestamp } from "./edit-task-modal";
import {
  updateTask,
  getTaskUpdates,
  addTaskUpdate,
  addSubtask,
  updateSubtask,
  deleteTask,
} from "./actions";
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

// A second workspace the signed-in user also belongs to, so the task has somewhere to move to.
const otherWs = {
  id: "a0000000-0000-4000-8000-000000000002",
  name: "Work",
  kind: "work",
  members: [
    { id: "b0000000-0000-4000-8000-000000000002", display_name: "Alice at work" },
    { id: "b0000000-0000-4000-8000-000000000003", display_name: "Bob" },
  ],
};

const memberIdByWorkspaceId = {
  [mockWs.id]: "b0000000-0000-4000-8000-000000000001",
  [otherWs.id]: "b0000000-0000-4000-8000-000000000002",
};

beforeEach(() => {
  // Every render of the modal fires the Updates-loading effect; default it to an empty list so
  // tests unrelated to Updates don't have to stub it themselves.
  jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
});

describe("EditTaskModal", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders with task values pre-filled", () => {
    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );
    expect(screen.getByDisplayValue("Buy groceries")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Milk and eggs")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-04-10")).toBeInTheDocument();
  });

  it("calls updateTask with updated values on submit", async () => {
    const mock = jest.mocked(updateTask);
    mock.mockResolvedValue({ ok: true });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
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
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={onClose} />
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
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={onClose} />
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
      <EditTaskModal open={false} task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );
    expect(screen.queryByDisplayValue("Buy groceries")).not.toBeInTheDocument();
  });
});

// ─── Dialog primitive behavior ────────────────────────────────────────────────

describe("EditTaskModal — Dialog primitive", () => {
  beforeEach(() => jest.clearAllMocks());

  it("focuses the title input when the modal opens, without user interaction", () => {
    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );
    expect(screen.getByDisplayValue("Buy groceries")).toHaveFocus();
  });

  it("pressing Escape calls the same onClose Cancel calls", () => {
    const onClose = jest.fn();
    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={onClose} />
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
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
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
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
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
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
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
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    await screen.findByPlaceholderText(/add an update/i);
    expect(screen.queryByRole("button", { name: /dictate/i })).not.toBeInTheDocument();
  });

  it("shows an inline error when loading updates fails, instead of rendering silently as empty", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: false, error: "Could not load updates" });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    expect(await screen.findByText("Could not load updates")).toBeInTheDocument();
  });

  it("puts Subtasks above Updates — structure first, then the log", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    const headings = (await screen.findAllByRole("heading", { level: 4 })).map((h) => h.textContent);
    expect(headings).toEqual(["Subtasks", "Updates"]);
  });

  it("gives each update an exact timestamp behind its relative label", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({
      ok: true,
      updates: [
        { id: "u1", authorName: "Alice", createdAt: "2026-07-26T09:00:00Z", updateText: "Ordered it" },
      ],
    });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    await screen.findByText("Ordered it");
    const time = document.querySelector("time[dateTime='2026-07-26T09:00:00Z']");
    // Without this, an update older than a day reads as a bare "Jul 26" with no time at all.
    expect(time).toHaveAttribute("title", formatUpdateTimestamp("2026-07-26T09:00:00Z"));
  });

  it("lets the update list grow with the modal instead of scrolling inside its own box", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({
      ok: true,
      updates: [
        { id: "u1", authorName: "Alice", createdAt: "2026-07-26T09:00:00Z", updateText: "Ordered it" },
      ],
    });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    const list = (await screen.findByText("Ordered it")).closest("ul");
    // A 160px scroller nested inside a scrollable dialog put two scroll regions under one gesture.
    expect(list?.className).not.toMatch(/max-h-40|overflow-y-auto/);
  });

  describe("dictation transcript handling", () => {
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      start = jest.fn();
      // Deferred like a real browser's `end` event, which fires after `stop()` has returned.
      stop = jest.fn(() => {
        queueMicrotask(() => this.onend?.());
      });
    }

    let instance: MockSpeechRecognition | null = null;

    beforeEach(() => {
      instance = null;
      (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
        instance = new MockSpeechRecognition();
        return instance;
      });
    });

    afterEach(() => {
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    });

    function fireResult(transcript: string, isFinal: boolean) {
      instance!.onresult?.({ results: [{ 0: { transcript }, isFinal }] });
    }

    it("replaces (not appends) interim transcripts, committing only the final result to the draft", async () => {
      jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });

      render(
        <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
      );

      await screen.findByPlaceholderText(/add an update/i);
      await userEvent.click(screen.getByRole("button", { name: /dictate update/i }));

      await act(async () => fireResult("hello", false));
      await act(async () => fireResult("hello world", false));
      await act(async () => fireResult("hello world today", true));

      expect(screen.getByPlaceholderText(/add an update/i)).toHaveValue("hello world today");
    });

    it("ends the dictation session when the update is submitted", async () => {
      jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
      jest.mocked(addTaskUpdate).mockResolvedValue({
        ok: true,
        update: { id: "u3", authorName: "Alice", createdAt: "2026-07-26T12:00:00Z", updateText: "dictated text" },
      });

      render(
        <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
      );

      await screen.findByPlaceholderText(/add an update/i);
      await userEvent.click(screen.getByRole("button", { name: /dictate update/i }));
      await act(async () => fireResult("dictated text", true));

      await userEvent.click(screen.getByRole("button", { name: /^add update$/i }));

      // Otherwise the recognizer keeps running against a draft that has already been submitted,
      // while the mic button is disabled by the in-flight transition and cannot stop it.
      expect(instance!.stop).toHaveBeenCalled();
      expect(await screen.findByRole("button", { name: /dictate update/i })).toBeInTheDocument();
    });
  });

  it("drops the previous task's updates when the modal switches to a different task", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({
      ok: true,
      updates: [
        { id: "u1", authorName: "Alice", createdAt: "2026-07-26T09:00:00Z", updateText: "First task update" },
      ],
    });

    const { rerender } = render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );
    await screen.findByText("First task update");

    // Second task's updates never resolve, so the only thing that can clear the first task's list
    // is the switch itself.
    jest.mocked(getTaskUpdates).mockReturnValue(new Promise(() => {}));
    const otherTask = { ...mockTask, id: "c0000000-0000-4000-8000-000000000002", title: "Other task" };
    rerender(
      <EditTaskModal open task={otherTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    expect(screen.queryByText("First task update")).not.toBeInTheDocument();
  });

  it("clears a previous load error when the modal switches to a different task", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: false, error: "Could not load updates" });

    const { rerender } = render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );
    await screen.findByText("Could not load updates");

    jest.mocked(getTaskUpdates).mockReturnValue(new Promise(() => {}));
    const otherTask = { ...mockTask, id: "c0000000-0000-4000-8000-000000000002", title: "Other task" };
    rerender(
      <EditTaskModal open task={otherTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    expect(screen.queryByText("Could not load updates")).not.toBeInTheDocument();
  });
});

// ─── Subtasks section ─────────────────────────────────────────────────────────

describe("EditTaskModal — Subtasks", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows existing subtasks from the task prop", () => {
    const taskWithSubtasks = { ...mockTask, subtasks: [{ id: "s1", title: "Existing subtask", completed_at: null, description: null, due_at: null }] };
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });

    render(
      <EditTaskModal open task={taskWithSubtasks} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    expect(screen.getByText("Existing subtask")).toBeInTheDocument();
  });

  it("optimistically appends a new subtask and calls addSubtask", async () => {
    jest.mocked(getTaskUpdates).mockResolvedValue({ ok: true, updates: [] });
    jest.mocked(addSubtask).mockResolvedValue({ ok: true, subtask: { id: "s2", title: "New subtask", completed_at: null, description: null, due_at: null } });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
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
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    await userEvent.type(screen.getByPlaceholderText(/new subtask title/i), "Will fail");
    await userEvent.click(screen.getByRole("button", { name: /^add subtask$/i }));

    await screen.findByText("Something went wrong");
    expect(screen.queryByText("Will fail")).not.toBeInTheDocument();
  });

  it("sends the details and due date typed alongside a new subtask title", async () => {
    jest.mocked(addSubtask).mockResolvedValue({
      ok: true,
      subtask: { id: "s2", title: "New subtask", completed_at: null, description: "Some detail", due_at: "2026-08-01T00:00:00Z" },
    });

    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    await userEvent.type(screen.getByPlaceholderText(/new subtask title/i), "New subtask");
    await userEvent.type(screen.getByLabelText(/new subtask details/i), "Some detail");
    fireEvent.change(screen.getByLabelText(/new subtask due date/i), {
      target: { value: "2026-08-01" },
    });
    await userEvent.click(screen.getByRole("button", { name: /^add subtask$/i }));

    await waitFor(() =>
      expect(addSubtask).toHaveBeenCalledWith({
        parentTaskId: mockTask.id,
        title: "New subtask",
        description: "Some detail",
        dueAt: "2026-08-01",
      })
    );
  });

  it("edits an existing subtask's title, details and due date", async () => {
    jest.mocked(updateSubtask).mockResolvedValue({ ok: true });
    const taskWithSubtasks = {
      ...mockTask,
      subtasks: [
        { id: "c0000000-0000-4000-8000-000000000009", title: "Existing subtask", completed_at: null, description: "Old detail", due_at: "2026-08-02T00:00:00Z" },
      ],
    };

    render(
      <EditTaskModal open task={taskWithSubtasks} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    // The values a subtask already holds have to be visible before they can be edited — they were
    // write-once at creation before this.
    expect(screen.getByText("Old detail")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /edit "existing subtask"/i }));

    const detailsField = screen.getByLabelText(/subtask details for "existing subtask"/i);
    expect(detailsField).toHaveValue("Old detail");
    expect(screen.getByLabelText(/subtask due date for "existing subtask"/i)).toHaveValue("2026-08-02");

    await userEvent.clear(detailsField);
    await userEvent.type(detailsField, "New detail");
    await userEvent.click(screen.getByRole("button", { name: /save subtask/i }));

    await waitFor(() =>
      expect(updateSubtask).toHaveBeenCalledWith({
        subtaskId: "c0000000-0000-4000-8000-000000000009",
        title: "Existing subtask",
        description: "New detail",
        dueAt: "2026-08-02",
      })
    );
    expect(await screen.findByText("New detail")).toBeInTheDocument();
  });

  it("rolls a failed subtask edit back to the values it held", async () => {
    jest.mocked(updateSubtask).mockResolvedValue({ ok: false, error: "Nope" });
    const taskWithSubtasks = {
      ...mockTask,
      subtasks: [
        { id: "c0000000-0000-4000-8000-000000000009", title: "Existing subtask", completed_at: null, description: "Old detail", due_at: null },
      ],
    };

    render(
      <EditTaskModal open task={taskWithSubtasks} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    await userEvent.click(screen.getByRole("button", { name: /edit "existing subtask"/i }));
    const titleField = screen.getByLabelText(/subtask title for "existing subtask"/i);
    await userEvent.clear(titleField);
    await userEvent.type(titleField, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: /save subtask/i }));

    await screen.findByText("Nope");
    expect(screen.getByText("Existing subtask")).toBeInTheDocument();
    expect(screen.queryByText("Renamed")).not.toBeInTheDocument();
  });

  it("asks for confirmation before deleting a subtask", async () => {
    const taskWithSubtasks = {
      ...mockTask,
      subtasks: [{ id: "s1", title: "Existing subtask", completed_at: null, description: null, due_at: null }],
    };

    render(
      <EditTaskModal open task={taskWithSubtasks} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    await userEvent.click(screen.getByRole("button", { name: /delete "existing subtask"/i }));

    expect(deleteTask).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete "Existing subtask"\?/)).toBeInTheDocument();
    expect(screen.getByText("Existing subtask")).toBeInTheDocument();
  });

  it("deletes the subtask once the confirmation is accepted", async () => {
    jest.mocked(deleteTask).mockResolvedValue({ ok: true });
    const taskWithSubtasks = {
      ...mockTask,
      subtasks: [{ id: "s1", title: "Existing subtask", completed_at: null, description: null, due_at: null }],
    };

    render(
      <EditTaskModal open task={taskWithSubtasks} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    await userEvent.click(screen.getByRole("button", { name: /delete "existing subtask"/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm delete "existing subtask"/i }));

    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("s1"));
    expect(screen.queryByText("Existing subtask")).not.toBeInTheDocument();
  });

  it("leaves the subtask in place when the confirmation is cancelled", async () => {
    const taskWithSubtasks = {
      ...mockTask,
      subtasks: [{ id: "s1", title: "Existing subtask", completed_at: null, description: null, due_at: null }],
    };

    render(
      <EditTaskModal open task={taskWithSubtasks} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );

    await userEvent.click(screen.getByRole("button", { name: /delete "existing subtask"/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel delete/i }));

    expect(deleteTask).not.toHaveBeenCalled();
    expect(screen.getByText("Existing subtask")).toBeInTheDocument();
  });
});

describe("formatUpdateTime", () => {
  const now = new Date("2026-07-26T12:00:00.000Z");
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

  it("reads as relative time inside the first day", () => {
    expect(formatUpdateTime(ago(5), now)).toBe("just now");
    expect(formatUpdateTime(ago(44), now)).toBe("just now");
    expect(formatUpdateTime(ago(60), now)).toBe("1m ago");
    expect(formatUpdateTime(ago(45 * 60), now)).toBe("45m ago");
    expect(formatUpdateTime(ago(2 * 3600), now)).toBe("2h ago");
  });

  it("never rounds a sub-minute-but-not-just-now gap down to '0m ago'", () => {
    expect(formatUpdateTime(ago(50), now)).toBe("1m ago");
  });

  it("falls back to an absolute date once relative stops being useful", () => {
    expect(formatUpdateTime(ago(3 * 86400), now)).toMatch(/Jul/);
  });

  it("returns an empty string rather than 'NaN' for an unparseable timestamp", () => {
    expect(formatUpdateTime("not a date", now)).toBe("");
  });
});

describe("formatUpdateTimestamp", () => {
  it("carries a clock time, which the relative label drops entirely past a day", () => {
    const formatted = formatUpdateTimestamp("2026-07-26T12:34:00.000Z");
    expect(formatted).toMatch(/Jul/);
    expect(formatted).toMatch(/2026/);
    // Locale and timezone decide the digits, so assert the shape rather than the value.
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });

  it("returns an empty string rather than 'Invalid Date' for an unparseable timestamp", () => {
    expect(formatUpdateTimestamp("not a date")).toBe("");
  });
});

describe("EditTaskModal — field labelling", () => {
  it.each([["Title"], ["Details (optional)"], ["Due date (optional)"]])(
    "associates the %s label with its control",
    (labelText) => {
      render(
        <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
      );
      expect(screen.getByLabelText(labelText)).toBeInTheDocument();
    }
  );

  it("groups the assignee checkboxes under an Assign to group label", () => {
    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );
    expect(screen.getByRole("group", { name: "Assign to" })).toBeInTheDocument();
  });
});

// ─── Moving a task to another workspace ──────────────────────────────────────

describe("EditTaskModal — workspace move", () => {
  beforeEach(() => jest.clearAllMocks());

  const bothWorkspaces = [mockWs, otherWs];

  function renderWithBoth(task: RawTask = mockTask) {
    return render(
      <EditTaskModal
        open
        task={task}
        workspaces={bothWorkspaces}
        memberIdByWorkspaceId={memberIdByWorkspaceId}
        onClose={() => {}}
      />
    );
  }

  // Nothing to move to means the control is noise, and it would read as an editable field that
  // cannot change.
  it("hides the workspace select when the user belongs to one workspace", () => {
    render(
      <EditTaskModal open task={mockTask} workspaces={[mockWs]} memberIdByWorkspaceId={memberIdByWorkspaceId} onClose={() => {}} />
    );
    expect(screen.queryByLabelText("Workspace")).not.toBeInTheDocument();
  });

  it("shows the task's workspace as the current selection", () => {
    renderWithBoth();
    expect(screen.getByLabelText("Workspace")).toHaveValue(mockWs.id);
  });

  it("swaps the assignee list to the destination's members and preselects the user's own row", async () => {
    renderWithBoth();

    await userEvent.selectOptions(screen.getByLabelText("Workspace"), otherWs.id);

    expect(screen.queryByLabelText("Alice")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Alice at work")).toBeChecked();
    expect(screen.getByLabelText("Bob")).not.toBeChecked();
  });

  it("restores the task's own assignees when the original workspace is reselected", async () => {
    renderWithBoth();
    const select = screen.getByLabelText("Workspace");

    await userEvent.selectOptions(select, otherWs.id);
    await userEvent.selectOptions(select, mockWs.id);

    expect(screen.getByLabelText("Alice")).toBeChecked();
  });

  it("warns that subtasks move too and assignments are replaced", async () => {
    renderWithBoth({
      ...mockTask,
      subtasks: [
        { id: "d0000000-0000-4000-8000-000000000001", title: "Sub", completed_at: null, description: null, due_at: null },
      ],
    });

    await userEvent.selectOptions(screen.getByLabelText("Workspace"), otherWs.id);

    expect(screen.getByText(/its subtask .*to Work/i)).toBeInTheDocument();
  });

  it("sends the destination workspace and its members on save", async () => {
    const mock = jest.mocked(updateTask);
    mock.mockResolvedValue({ ok: true });

    renderWithBoth();
    await userEvent.selectOptions(screen.getByLabelText("Workspace"), otherWs.id);
    await userEvent.click(screen.getByLabelText("Bob"));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: mockTask.id,
          workspaceId: otherWs.id,
          memberIds: [memberIdByWorkspaceId[otherWs.id], "b0000000-0000-4000-8000-000000000003"],
        })
      )
    );
  });

  // The task's own workspace still travels with every save, so the action can tell "no move
  // requested" from "moved back", without the modal having to special-case it.
  it("sends the current workspace when nothing was moved", async () => {
    const mock = jest.mocked(updateTask);
    mock.mockResolvedValue({ ok: true });

    renderWithBoth();
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: mockWs.id }))
    );
  });
});
