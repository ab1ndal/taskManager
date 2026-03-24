import { render, screen } from "@testing-library/react";
import { TaskCard, DeadlineBadge, EmptyState } from "../task-card";

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
    title: "Buy groceries",
    deadline: "Overdue",
    deadlineVariant: "red" as const,
    workspace: "Household",
  };

  it("renders task title", () => {
    render(<TaskCard {...baseProps} />);
    expect(screen.getByText("Buy groceries")).toBeInTheDocument();
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
