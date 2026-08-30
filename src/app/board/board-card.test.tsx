import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

import { BoardCard } from "./board-card";
import type { BoardTask } from "./group-columns";

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
