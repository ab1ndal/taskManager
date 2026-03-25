import { render, screen, fireEvent } from "@testing-library/react";
import { NewTaskModal } from "./new-task-modal";

jest.mock("./actions", () => ({
  createTask: jest.fn().mockResolvedValue(undefined),
}));

const workspaces = [
  {
    id: "ws-1",
    name: "Home",
    kind: "household",
    members: [{ id: "m-1", display_name: "Alice" }],
  },
];

describe("NewTaskModal", () => {
  it("submit button is disabled when title is empty", () => {
    render(<NewTaskModal workspaces={workspaces} currentMemberIds={["m-1"]} />);
    fireEvent.click(screen.getByRole("button", { name: /new task/i }));
    expect(screen.getByRole("button", { name: /add task/i })).toBeDisabled();
  });

  it("enables submit once title is entered", () => {
    render(<NewTaskModal workspaces={workspaces} currentMemberIds={["m-1"]} />);
    fireEvent.click(screen.getByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByPlaceholderText(/task title/i), {
      target: { value: "Buy milk" },
    });
    expect(screen.getByRole("button", { name: /add task/i })).not.toBeDisabled();
  });

  it("closes the modal when cancel is clicked", () => {
    render(<NewTaskModal workspaces={workspaces} currentMemberIds={["m-1"]} />);
    fireEvent.click(screen.getByRole("button", { name: /new task/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByPlaceholderText(/task title/i)).not.toBeInTheDocument();
  });
});
