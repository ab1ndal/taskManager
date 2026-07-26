jest.mock("@/app/tasks/actions", () => ({
  completeTask: jest.fn(),
  deleteTask: jest.fn(),
}));

jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { completeTask, deleteTask } from "@/app/tasks/actions";
import { toast } from "@/components/toaster";
import { TaskCard, DeadlineBadge, EmptyState } from "../task-card";

beforeAll(() => {
  // jsdom does not implement showModal(); mock it so the delete confirm dialog can render.
  HTMLDialogElement.prototype.showModal = jest.fn();
  HTMLDialogElement.prototype.close = jest.fn();
});

describe("DeadlineBadge", () => {
  it("renders the label text", () => {
    render(<DeadlineBadge variant="red" label="Overdue" />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("renders green variant label", () => {
    render(<DeadlineBadge variant="green" label="Due in 3 days" />);
    expect(screen.getByText("Due in 3 days")).toBeInTheDocument();
  });
});

describe("TaskCard", () => {
  const baseProps = {
    taskId: "t-1",
    title: "Buy groceries",
    deadline: "Overdue",
    deadlineVariant: "red" as const,
    workspace: "Household",
  };

  it("renders task title", () => {
    render(<TaskCard {...baseProps} />);
    expect(screen.getByText("Buy groceries")).toBeInTheDocument();
  });

  it("gives the complete button a task-scoped aria-label and 44px hit area", () => {
    render(<TaskCard {...baseProps} />);
    const completeButton = screen.getByRole("button", { name: 'Mark "Buy groceries" complete' });
    expect(completeButton).toBeInTheDocument();
    expect(completeButton).toHaveClass("w-11", "h-11");
  });

  it("renders workspace label", () => {
    render(<TaskCard {...baseProps} />);
    expect(screen.getByText("Household")).toBeInTheDocument();
  });

  it("renders Shared badge when shared=true", () => {
    render(<TaskCard {...baseProps} shared />);
    expect(screen.getByText("Shared")).toBeInTheDocument();
  });

  it("does not render Shared badge when shared is omitted", () => {
    render(<TaskCard {...baseProps} />);
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders empty state message", () => {
    render(<EmptyState />);
    expect(screen.getByText(/No tasks yet/)).toBeInTheDocument();
  });
});

describe("TaskCard — mutation failures", () => {
  const baseProps = {
    taskId: "c0000000-0000-4000-8000-000000000001",
    title: "Buy groceries",
    workspace: "Household",
  };

  beforeEach(() => jest.clearAllMocks());

  it("toasts the error when completing fails", async () => {
    (completeTask as jest.Mock).mockResolvedValue({ ok: false, error: "Forbidden: not assigned" });
    render(<TaskCard {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: 'Mark "Buy groceries" complete' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("Forbidden: not assigned", "error")
    );
  });

  it("stays silent when completing succeeds", async () => {
    (completeTask as jest.Mock).mockResolvedValue({ ok: true });
    render(<TaskCard {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: 'Mark "Buy groceries" complete' }));

    await waitFor(() => expect(completeTask).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
  });

  it("opens the confirm dialog on delete-trigger click without calling deleteTask yet", () => {
    render(<TaskCard {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: 'Delete "Buy groceries"' }));

    expect(screen.getByText('Delete "Buy groceries"?', { exact: false })).toBeInTheDocument();
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("toasts the error when confirming delete fails", async () => {
    (deleteTask as jest.Mock).mockResolvedValue({ ok: false, error: "Something went wrong. Please try again." });
    render(<TaskCard {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: 'Delete "Buy groceries"' }));
    fireEvent.click(screen.getByRole("button", { name: 'Confirm delete "Buy groceries"', hidden: true }));

    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("c0000000-0000-4000-8000-000000000001"));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("Something went wrong. Please try again.", "error")
    );
  });
});

describe("TaskCard — subtasks and accessibility", () => {
  const baseProps = {
    taskId: "c0000000-0000-4000-8000-000000000001",
    title: "Buy groceries",
    workspace: "Household",
    subtasks: [{ id: "s-1", title: "Water the plants", completed_at: null }],
  };

  it("gives a subtask toggle a task-scoped aria-label and 44px hit area", () => {
    render(<TaskCard {...baseProps} />);
    const subtaskButton = screen.getByRole("button", {
      name: 'Mark "Water the plants" complete',
    });
    expect(subtaskButton).toBeInTheDocument();
    expect(subtaskButton).toHaveClass("w-11", "h-11");
  });

  it("has no axe violations", async () => {
    const { container } = render(<TaskCard {...baseProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("TaskCard — drag handle", () => {
  it("renders a drag handle when dragHandleProps is provided", () => {
    render(
      <TaskCard
        taskId="t1"
        title="Task 1"
        workspace="Home"
        dragHandleProps={{ "aria-describedby": "drag-instructions" } as React.HTMLAttributes<HTMLButtonElement>}
      />
    );
    const handle = screen.getByLabelText('Reorder "Task 1"');
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveAttribute("aria-describedby", "drag-instructions");
  });

  it("renders no drag handle when dragHandleProps is omitted", () => {
    render(<TaskCard taskId="t1" title="Task 1" workspace="Home" />);
    expect(screen.queryByLabelText('Reorder "Task 1"')).not.toBeInTheDocument();
  });
});
