import { render, screen, fireEvent } from "@testing-library/react";
import { CompletedSection } from "./completed-section";

// TaskCard calls server actions — stub to avoid import issues in jsdom
jest.mock("@/components/task-card", () => ({
  TaskCard: ({ title }: { title: string }) => <div>{title}</div>,
}));

const tasks = [
  {
    taskId: "1",
    title: "Done A",
    deadline: null,
    deadlineVariant: null,
    workspace: "Home",
    shared: false,
    completed: true as const,
  },
  {
    taskId: "2",
    title: "Done B",
    deadline: null,
    deadlineVariant: null,
    workspace: "Work",
    shared: false,
    completed: true as const,
  },
];

describe("CompletedSection", () => {
  it("is collapsed by default", () => {
    render(<CompletedSection tasks={tasks} />);
    expect(screen.queryByText("Done A")).not.toBeInTheDocument();
  });

  it("shows count in toggle label", () => {
    render(<CompletedSection tasks={tasks} />);
    expect(screen.getByRole("button")).toHaveTextContent("2 completed");
  });

  it("reveals tasks after clicking toggle", () => {
    render(<CompletedSection tasks={tasks} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Done A")).toBeInTheDocument();
    expect(screen.getByText("Done B")).toBeInTheDocument();
  });

  it("collapses again on second click", () => {
    render(<CompletedSection tasks={tasks} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByText("Done A")).not.toBeInTheDocument();
  });

  it("renders nothing when tasks list is empty", () => {
    const { container } = render(<CompletedSection tasks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
