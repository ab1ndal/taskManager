jest.mock("./actions", () => ({ updateTask: jest.fn() }));
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditTaskModal } from "./edit-task-modal";
import { updateTask } from "./actions";
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
