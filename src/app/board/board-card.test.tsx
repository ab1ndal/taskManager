jest.mock("@/app/tasks/actions", () => ({
  completeTask: jest.fn(),
  reopenTask: jest.fn(),
  deleteTask: jest.fn(),
}));

jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import { deleteTask } from "@/app/tasks/actions";
import { BoardCard } from "./board-card";
import type { BoardTask } from "./group-columns";

beforeAll(() => {
  // jsdom does not implement showModal(); the card's delete confirmation renders a <dialog>.
  HTMLDialogElement.prototype.showModal = jest.fn();
  HTMLDialogElement.prototype.close = jest.fn();
});

const NOW = new Date("2026-08-28T12:00:00.000Z");

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    title: "Call the plumber",
    dueAt: null,
    completedAt: null,
    workspaceId: "a0000000-0000-4000-8000-000000000001",
    workspaceName: "Household",
    workspaceKind: "household",
    boardColumnId: "e0000000-0000-4000-8000-00000000000a",
    memberSortKey: 1000,
    assigneeCount: 1,
    ...overrides,
  };
}

it("shows the title, and nothing the board deliberately omits", () => {
  render(<BoardCard task={task()} showWorkspace now={NOW} />);

  expect(screen.getByText("Call the plumber")).toBeInTheDocument();
  expect(screen.getByText("Household")).toBeInTheDocument();
  expect(screen.getByText("No due date")).toBeInTheDocument();
});

it("marks an overdue deadline red and names it", () => {
  render(<BoardCard task={task({ dueAt: "2026-08-20T00:00:00.000Z" })} showWorkspace now={NOW} />);

  const pill = screen.getByText("Overdue");
  expect(pill).toHaveAttribute("data-variant", "red");
});

it("marks a deadline due today yellow", () => {
  render(<BoardCard task={task({ dueAt: "2026-08-28T00:00:00.000Z" })} showWorkspace now={NOW} />);

  expect(screen.getByText("Due today")).toHaveAttribute("data-variant", "yellow");
});

it("marks a deadline with time remaining green", () => {
  render(<BoardCard task={task({ dueAt: "2026-09-04T00:00:00.000Z" })} showWorkspace now={NOW} />);

  expect(screen.getByText("Due in 7 days")).toHaveAttribute("data-variant", "green");
});

it("treats a task with no deadline as green, per docs/product.md", () => {
  render(<BoardCard task={task()} showWorkspace now={NOW} />);

  expect(screen.getByText("No due date")).toHaveAttribute("data-variant", "green");
});

it("shows a shared badge only when more than one person is assigned", () => {
  const { rerender } = render(<BoardCard task={task({ assigneeCount: 1 })} showWorkspace now={NOW} />);
  expect(screen.queryByLabelText(/shared with/i)).not.toBeInTheDocument();

  rerender(<BoardCard task={task({ assigneeCount: 3 })} showWorkspace now={NOW} />);
  expect(screen.getByLabelText("Shared with 2 other people")).toBeInTheDocument();
});

it("hides the workspace chip when the board is scoped to one workspace", () => {
  render(<BoardCard task={task()} showWorkspace={false} now={NOW} />);

  expect(screen.queryByText("Household")).not.toBeInTheDocument();
});

it("reads a completed card as completed", () => {
  render(
    <BoardCard task={task({ completedAt: "2026-08-27T09:00:00.000Z" })} showWorkspace now={NOW} />
  );

  expect(screen.getByText("Completed")).toBeInTheDocument();
});

it("reads a completed card as neutral even when its due_at is overdue", () => {
  render(
    <BoardCard
      task={task({ dueAt: "2026-08-20T00:00:00.000Z", completedAt: "2026-08-27T09:00:00.000Z" })}
      showWorkspace
      now={NOW}
    />
  );

  expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  const pill = screen.getByText("Completed");
  expect(pill).not.toHaveAttribute("data-variant");
});

it("has no accessibility violations", async () => {
  const { container } = render(
    <BoardCard task={task({ dueAt: "2026-08-20T00:00:00.000Z", assigneeCount: 2 })} showWorkspace now={NOW} />
  );

  expect(await axe(container)).toHaveNoViolations();
});


describe("card actions", () => {
  it("opens the task when the card body is pressed", () => {
    const onOpen = jest.fn();
    render(<BoardCard task={task()} showWorkspace={false} onOpen={onOpen} now={NOW} />);

    fireEvent.click(screen.getByText("Call the plumber"));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens the task on Enter, leaving Space to the drag sensor", () => {
    const onOpen = jest.fn();
    const onKeyDown = jest.fn();
    render(
      <BoardCard
        task={task()}
        showWorkspace={false}
        onOpen={onOpen}
        dragHandleProps={{ onKeyDown }}
        now={NOW}
      />
    );

    const body = screen.getByText("Call the plumber").parentElement!;
    fireEvent.keyDown(body, { key: " " });
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.keyDown(body, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);

    // The library's own handler still sees every key: the card adds to it rather than replacing it.
    expect(onKeyDown).toHaveBeenCalledTimes(2);
  });

  it("offers complete and delete, and edit only while the task is open", () => {
    render(<BoardCard task={task()} showWorkspace={false} onOpen={jest.fn()} now={NOW} />);

    fireEvent.click(screen.getByRole("button", { name: 'More actions for "Call the plumber"' }));

    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Complete" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("offers reopen rather than complete on a completed card, and no edit", () => {
    render(
      <BoardCard
        task={task({ completedAt: "2026-08-27T09:00:00.000Z" })}
        showWorkspace={false}
        now={NOW}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: 'More actions for "Call the plumber"' }));

    expect(screen.getByRole("menuitem", { name: "Reopen" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Complete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("deletes only after the confirmation is accepted", async () => {
    (deleteTask as jest.Mock).mockResolvedValue({ ok: true });
    render(<BoardCard task={task()} showWorkspace={false} onOpen={jest.fn()} now={NOW} />);

    fireEvent.click(screen.getByRole("button", { name: 'More actions for "Call the plumber"' }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(deleteTask).not.toHaveBeenCalled();

    // `hidden: true` because jsdom's showModal is a stub, so the <dialog> never becomes open and
    // its contents stay out of the accessibility tree. Same as the list card's test.
    fireEvent.click(
      screen.getByRole("button", { name: 'Confirm delete "Call the plumber"', hidden: true })
    );

    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith(task().id));
  });

  it("does not clip a long title", () => {
    const long =
      "Renew the household contents insurance policy before the end of the month";
    render(<BoardCard task={task({ title: long })} showWorkspace={false} now={NOW} />);

    const heading = screen.getByRole("heading", { name: long });
    expect(heading).toHaveTextContent(long);
    expect(heading.className).not.toContain("truncate");
  });
});
