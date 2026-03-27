import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewTaskModal } from "./new-task-modal";

import { createTaskWithSubtasks } from "./actions";

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
    members: [
      { id: "m-1", display_name: "Alice" },
      { id: "m-2", display_name: "Bob" },
    ],
  },
  {
    id: "ws-2",
    name: "Acme Corp",
    kind: "work",
    members: [{ id: "m-3", display_name: "Carol" }],
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

// ─── Validation ──────────────────────────────────────────────────────────────

describe("NewTaskModal — validation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("submit is disabled when title is present but no member is checked", () => {
    renderModal();
    // Uncheck Alice (the default auto-checked member)
    fireEvent.click(screen.getByRole("checkbox", { name: /alice/i }));
    fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: "Buy milk" } });
    expect(screen.getByRole("button", { name: /add task/i })).toBeDisabled();
  });

  it("submit is disabled when members are checked but title is empty", () => {
    renderModal();
    // Alice is checked by default; title is empty
    expect(screen.getByRole("button", { name: /add task/i })).toBeDisabled();
  });

  it("submit is enabled when title is non-empty and at least one member is checked", () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: "Do laundry" } });
    expect(screen.getByRole("button", { name: /add task/i })).not.toBeDisabled();
  });
});

// ─── Adding details (description) ────────────────────────────────────────────

describe("NewTaskModal — description field", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passes description to createTaskWithSubtasks when filled in", async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: "Plan trip" } });
    fireEvent.change(screen.getByPlaceholderText(/add details/i), { target: { value: "Book flights and hotel" } });
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createTaskWithSubtasks).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Book flights and hotel" })
    );
  });

  it("omits description from call when textarea is empty", async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: "Quick task" } });
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createTaskWithSubtasks).toHaveBeenCalledWith(
      expect.objectContaining({ description: undefined })
    );
  });
});

// ─── Member toggling ─────────────────────────────────────────────────────────

describe("NewTaskModal — member selection", () => {
  beforeEach(() => jest.clearAllMocks());

  it("auto-checks current user's member on open", () => {
    renderModal();
    // m-1 (Alice) is in currentMemberIds so should be pre-checked
    expect(screen.getByRole("checkbox", { name: /alice/i })).toBeChecked();
  });

  it("unchecking a member removes them from assignment", async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: "Solo task" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /alice/i })); // uncheck
    fireEvent.click(screen.getByRole("checkbox", { name: /bob/i }));   // check Bob
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createTaskWithSubtasks).toHaveBeenCalledWith(
      expect.objectContaining({ memberIds: ["m-2"] })
    );
  });

  it("checking an additional member adds them to assignment", async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: "Shared task" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /bob/i })); // add Bob
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createTaskWithSubtasks).toHaveBeenCalledWith(
      expect.objectContaining({ memberIds: expect.arrayContaining(["m-1", "m-2"]) })
    );
  });
});

// ─── Workspace switching ──────────────────────────────────────────────────────

describe("NewTaskModal — workspace switching", () => {
  beforeEach(() => jest.clearAllMocks());

  it("switches workspace and shows new workspace members", () => {
    renderModal();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ws-2" } });
    expect(screen.getByRole("checkbox", { name: /carol/i })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /alice/i })).not.toBeInTheDocument();
  });

  it("resets member selection when workspace changes", () => {
    renderModal();
    // Check Bob first in ws-1
    fireEvent.click(screen.getByRole("checkbox", { name: /bob/i }));
    // Switch to ws-2 — Carol is not in currentMemberIds so she should be unchecked
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ws-2" } });
    expect(screen.getByRole("checkbox", { name: /carol/i })).not.toBeChecked();
  });
});

// ─── Subtask details ─────────────────────────────────────────────────────────

describe("NewTaskModal — subtask details", () => {
  beforeEach(() => jest.clearAllMocks());

  it("can edit a subtask title after adding it", () => {
    renderModal();
    fireEvent.click(screen.getByText(/add subtask/i));
    fireEvent.change(screen.getByPlaceholderText(/subtask title/i), { target: { value: "Buy groceries" } });
    expect(screen.getByDisplayValue("Buy groceries")).toBeInTheDocument();
  });

  it("submits subtask title and due date to action", async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: "Weekly prep" } });
    fireEvent.click(screen.getByText(/add subtask/i));
    fireEvent.change(screen.getByPlaceholderText(/subtask title/i), { target: { value: "Plan menu" } });
    // Set the subtask date input (type="date" — distinct from the parent's datetime-local)
    const dateInput = document.querySelector("input[type='date']") as HTMLInputElement;
    if (dateInput) fireEvent.change(dateInput, { target: { value: "2026-04-10" } });
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createTaskWithSubtasks).toHaveBeenCalledWith(
      expect.objectContaining({
        subtasks: expect.arrayContaining([
          expect.objectContaining({ title: "Plan menu" }),
        ]),
      })
    );
  });

  it("filters out subtask rows with empty titles before submitting", async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: "Main task" } });
    fireEvent.click(screen.getByText(/add subtask/i));
    // Leave subtask title empty
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createTaskWithSubtasks).toHaveBeenCalledWith(
      expect.objectContaining({ subtasks: [] })
    );
  });

  it("pressing Enter in a subtask with content adds another subtask row", () => {
    renderModal();
    fireEvent.click(screen.getByText(/add subtask/i));
    const input = screen.getByPlaceholderText(/subtask title/i);
    fireEvent.change(input, { target: { value: "First subtask" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getAllByPlaceholderText(/subtask title/i)).toHaveLength(2);
  });

  it("pressing Enter in an empty subtask does not add a new row", () => {
    renderModal();
    fireEvent.click(screen.getByText(/add subtask/i));
    const input = screen.getByPlaceholderText(/subtask title/i);
    fireEvent.keyDown(input, { key: "Enter" }); // title is still empty
    expect(screen.getAllByPlaceholderText(/subtask title/i)).toHaveLength(1);
  });

  it("multiple subtask rows are all removable independently", () => {
    renderModal();
    fireEvent.click(screen.getByText(/add subtask/i));
    fireEvent.click(screen.getByText(/add subtask/i));
    expect(screen.getAllByPlaceholderText(/subtask title/i)).toHaveLength(2);
    // Remove the first one
    fireEvent.click(screen.getAllByRole("button", { name: /remove subtask/i })[0]);
    expect(screen.getAllByPlaceholderText(/subtask title/i)).toHaveLength(1);
  });
});

// ─── Error / partial-success states ──────────────────────────────────────────

describe("NewTaskModal — error handling", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls onClose and resets form on successful submit", async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: "Success task" } });
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Form resets — title input is back to empty
    expect(screen.getByPlaceholderText(/task title/i)).toHaveValue("");
  });

  it("does not close modal when action throws", async () => {
    (createTaskWithSubtasks as jest.Mock).mockRejectedValueOnce(new Error("Server error"));
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: "Bad task" } });
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => expect(createTaskWithSubtasks).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});
