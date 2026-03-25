import { render, screen, fireEvent } from "@testing-library/react";
import { NewTaskModal } from "./new-task-modal";

jest.mock("./actions", () => ({
  createTask: jest.fn().mockResolvedValue(undefined),
  createTaskWithSubtasks: jest.fn().mockResolvedValue({ subtaskErrors: 0 }),
}));

jest.mock("next/navigation", () => ({ useSearchParams: jest.fn(() => new URLSearchParams()) }));

const workspaces = [
  {
    id: "ws-1",
    name: "Home",
    kind: "household",
    members: [{ id: "m-1", display_name: "Alice" }],
  },
];

function renderModal(open = true) {
  const onClose = jest.fn();
  render(
    <NewTaskModal
      open={open}
      onClose={onClose}
      workspaces={workspaces}
      currentMemberIds={["m-1"]}
    />
  );
  return { onClose };
}

describe("NewTaskModal", () => {
  it("renders nothing when open is false", () => {
    renderModal(false);
    expect(screen.queryByPlaceholderText(/task title/i)).not.toBeInTheDocument();
  });

  it("renders modal when open is true", () => {
    renderModal(true);
    expect(screen.getByPlaceholderText(/task title/i)).toBeInTheDocument();
  });

  it("submit button is disabled when title is empty", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /add task/i })).toBeDisabled();
  });

  it("enables submit once title is entered", () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/task title/i), {
      target: { value: "Buy milk" },
    });
    expect(screen.getByRole("button", { name: /add task/i })).not.toBeDisabled();
  });

  it("calls onClose when cancel is clicked", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders description textarea", () => {
    renderModal();
    expect(screen.getByPlaceholderText(/add details/i)).toBeInTheDocument();
  });

  it("renders '+ Add subtask' link", () => {
    renderModal();
    expect(screen.getByText(/add subtask/i)).toBeInTheDocument();
  });

  it("clicking '+ Add subtask' adds a subtask row", () => {
    renderModal();
    fireEvent.click(screen.getByText(/add subtask/i));
    expect(screen.getByPlaceholderText(/subtask title/i)).toBeInTheDocument();
  });

  it("clicking ✕ on a subtask row removes it", () => {
    renderModal();
    fireEvent.click(screen.getByText(/add subtask/i));
    expect(screen.getByPlaceholderText(/subtask title/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove subtask/i }));
    expect(screen.queryByPlaceholderText(/subtask title/i)).not.toBeInTheDocument();
  });
});
