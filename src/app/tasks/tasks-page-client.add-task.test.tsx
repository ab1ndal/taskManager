// Integration coverage for the optimistic add-task flow: unlike tasks-page-client.test.tsx, this
// file does NOT mock NewTaskModal or TaskCard — it exercises the real useOptimistic dispatch inside
// NewTaskModal's transition together with TasksPageClient's own useOptimistic overlay, which a
// mocked NewTaskModal cannot reach (its dispatch must run inside the exact transition that awaits
// the server call — see the comment in new-task-modal.tsx).
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { TasksPageClient } from "./tasks-page-client";
import { createTaskWithSubtasks } from "./actions";
import { toast } from "@/components/toaster";

jest.mock("./actions", () => ({
  reorderTask: jest.fn(),
  createTaskWithSubtasks: jest.fn(),
}));

jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

jest.mock("./edit-task-modal", () => ({
  EditTaskModal: () => <div data-testid="mock-edit-modal" />,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(() => new URLSearchParams()),
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));

beforeAll(() => {
  // jsdom does not implement showModal(); NewTaskModal's Dialog needs it to mount without throwing.
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

const workspace = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Home",
  kind: "household",
  members: [{ id: "b0000000-0000-4000-8000-000000000001", display_name: "Alice" }],
};

function existingTask(overrides: Partial<Parameters<typeof render>[0]> = {}) {
  void overrides;
  return {
    id: "t-existing",
    title: "Existing task",
    due_at: null,
    completed_at: null,
    workspace: { id: workspace.id, name: workspace.name, kind: workspace.kind },
    member_sort_key: 1000,
    assignee_count: 1,
    member_ids: [workspace.members[0].id],
    subtasks: [],
  };
}

function renderPage(initialTasks = [existingTask()]) {
  return render(
    <TasksPageClient
      workspaces={[workspace]}
      currentMemberIds={[workspace.members[0].id]}
      memberIdByWorkspaceId={{ [workspace.id]: workspace.members[0].id }}
      initialTasks={initialTasks}
    />
  );
}

function openModalAndTypeTitle(title: string) {
  fireEvent.click(screen.getAllByRole("button", { name: /new task/i })[0]);
  fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: title } });
}

describe("TasksPageClient — optimistic add (integration)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows the temp row immediately, appended after existing tasks (not jumping to the top)", async () => {
    // A controlled, eventually-resolved promise: a promise left permanently pending here would
    // leave its transition entangled forever, bleeding into later tests in this file (same React
    // instance across tests in one run) — exactly the flakiness that produced this test.
    let resolveServer!: (v: { ok: true; subtaskErrors: number; recurrenceFailed: boolean }) => void;
    (createTaskWithSubtasks as jest.Mock).mockReturnValue(
      new Promise((res) => {
        resolveServer = res;
      })
    );
    renderPage();

    openModalAndTypeTitle("New task one");
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    const titles = screen.getAllByText(/task/i, { selector: "p" }).map((el) => el.textContent);
    expect(titles).toEqual(["Existing task", "New task one"]);

    await act(async () => {
      resolveServer({ ok: true, subtaskErrors: 0, recurrenceFailed: false });
    });
  });

  it("removes the temp row and toasts an error when the server rejects", async () => {
    (createTaskWithSubtasks as jest.Mock).mockResolvedValue({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
    renderPage();

    openModalAndTypeTitle("Doomed task");
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    expect(screen.getByText("Doomed task")).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText("Doomed task")).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith("Something went wrong. Please try again.", "error");
  });

  it("reconciles into the real row once revalidation delivers it, without a duplicate", async () => {
    (createTaskWithSubtasks as jest.Mock).mockResolvedValue({
      ok: true,
      subtaskErrors: 0,
      recurrenceFailed: false,
    });
    const { rerender } = renderPage();

    openModalAndTypeTitle("Confirmed task");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add task/i }));
    });

    // Simulates the server action's revalidatePath delivering a fresh `initialTasks` prop.
    rerender(
      <TasksPageClient
        workspaces={[workspace]}
        currentMemberIds={[workspace.members[0].id]}
        memberIdByWorkspaceId={{ [workspace.id]: workspace.members[0].id }}
        initialTasks={[
          existingTask(),
          { ...existingTask(), id: "t-real", title: "Confirmed task", member_sort_key: 2000 },
        ]}
      />
    );

    expect(screen.getAllByText("Confirmed task")).toHaveLength(1);
  });
});
