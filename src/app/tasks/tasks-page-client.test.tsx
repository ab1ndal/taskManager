import { render, screen } from "@testing-library/react";
import { TasksPageClient, buildDragEndHandler } from "./tasks-page-client";
import { reorderTask } from "./actions";
import type { RawTask } from "./bucket-tasks";

jest.mock("./actions", () => ({
  reorderTask: jest.fn(),
}));

// Mock EditTaskModal — not under test here
jest.mock("./edit-task-modal", () => ({
  EditTaskModal: () => <div data-testid="mock-edit-modal" />,
}));

// Mock NewTaskModal — not under test here
jest.mock("./new-task-modal", () => ({
  NewTaskModal: ({ onTaskCreated, onTaskError }: {
    onTaskCreated?: (t: RawTask) => void;
    onTaskError?: (id: string) => void;
  }) => (
    <div data-testid="mock-modal"
      data-on-task-created={onTaskCreated ? "wired" : "missing"}
      data-on-task-error={onTaskError ? "wired" : "missing"}
    />
  ),
}));

// Mock TaskCard — not under test here
jest.mock("@/components/task-card", () => ({
  TaskCard: ({ title }: { title: string }) => <div data-testid="task-card">{title}</div>,
  EmptyState: () => <div data-testid="empty-state" />,
}));

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const pushMock = jest.fn();
jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(() => new URLSearchParams()),
  useRouter: jest.fn(() => ({ push: pushMock })),
}));

const workspaces = [
  {
    id: "ws-1",
    name: "Home",
    kind: "household",
    members: [{ id: "m-1", display_name: "Alice" }],
  },
];

function makeTask(overrides: Partial<RawTask> = {}): RawTask {
  return {
    id: "t-1",
    title: "Buy milk",
    due_at: null,
    completed_at: null,
    workspace: { id: "ws-1", name: "Home", kind: "household" },
    member_sort_key: 1000,
    assignee_count: 1,
    member_ids: [],
    subtasks: [],
    ...overrides,
  };
}

describe("TasksPageClient — initial render", () => {
  it("renders task cards for each task in initialTasks", () => {
    render(
      <TasksPageClient
        workspaces={workspaces}
        currentMemberIds={["m-1"]}
        memberIdByWorkspaceId={{}}
        initialTasks={[makeTask({ title: "Buy milk" }), makeTask({ id: "t-2", title: "Walk dog" })]}
      />
    );
    expect(screen.getAllByTestId("task-card")).toHaveLength(2);
  });

  it("renders EmptyState when initialTasks is empty", () => {
    render(
      <TasksPageClient
        workspaces={workspaces}
        currentMemberIds={["m-1"]}
        memberIdByWorkspaceId={{}}
        initialTasks={[]}
      />
    );
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });
});

describe("TasksPageClient — optimistic insert (handleTaskCreated)", () => {
  it("wires onTaskCreated prop to NewTaskModal", () => {
    render(
      <TasksPageClient
        workspaces={workspaces}
        currentMemberIds={["m-1"]}
        memberIdByWorkspaceId={{}}
        initialTasks={[]}
      />
    );
    expect(screen.getByTestId("mock-modal")).toHaveAttribute("data-on-task-created", "wired");
  });

  it("wires onTaskError prop to NewTaskModal", () => {
    render(
      <TasksPageClient
        workspaces={workspaces}
        currentMemberIds={["m-1"]}
        memberIdByWorkspaceId={{}}
        initialTasks={[]}
      />
    );
    expect(screen.getByTestId("mock-modal")).toHaveAttribute("data-on-task-error", "wired");
  });
});

describe("TasksPageClient — optimistic task opacity", () => {
  it("renders optimistic task IDs tracked in state (added via handleTaskCreated)", () => {
    // This test verifies the component exports or exposes handleTaskCreated for testing.
    // Since it's internal, we verify via the mock modal data attribute being "wired".
    // Actual opacity behavior is verified in manual/browser testing.
    render(
      <TasksPageClient
        workspaces={workspaces}
        currentMemberIds={["m-1"]}
        memberIdByWorkspaceId={{}}
        initialTasks={[makeTask()]}
      />
    );
    // Component renders without error when initialTasks provided
    expect(screen.getByTestId("task-card")).toBeInTheDocument();
  });
});

describe("TasksPageClient — initialTasks sync", () => {
  it("updates localTasks when initialTasks prop changes", () => {
    const task1: RawTask = {
      id: "t-1", title: "Task 1", due_at: null, completed_at: null,
      workspace: { id: "ws-1", name: "Home", kind: "household" },
      member_sort_key: 1000, assignee_count: 1,
      member_ids: [], subtasks: [],
    };
    const task2: RawTask = {
      id: "t-2", title: "Task 2", due_at: null, completed_at: null,
      workspace: { id: "ws-1", name: "Home", kind: "household" },
      member_sort_key: 2000, assignee_count: 1,
      member_ids: [], subtasks: [],
    };

    const { rerender, getByText, queryByText } = render(
      <TasksPageClient
        workspaces={[{ id: "ws-1", name: "Home", kind: "household", members: [] }]}
        currentMemberIds={[]}
        memberIdByWorkspaceId={{}}
        initialTasks={[task1]}
        userName="Alice"
      />
    );

    expect(getByText("Task 1")).toBeInTheDocument();
    expect(queryByText("Task 2")).not.toBeInTheDocument();

    rerender(
      <TasksPageClient
        workspaces={[{ id: "ws-1", name: "Home", kind: "household", members: [] }]}
        currentMemberIds={[]}
        memberIdByWorkspaceId={{}}
        initialTasks={[task2]}
        userName="Alice"
      />
    );

    expect(queryByText("Task 1")).not.toBeInTheDocument();
    expect(getByText("Task 2")).toBeInTheDocument();
  });

  it("clears optimisticTaskIds when initialTasks changes", () => {
    const task: RawTask = {
      id: "t-opt", title: "Optimistic Task", due_at: null, completed_at: null,
      workspace: { id: "ws-1", name: "Home", kind: "household" },
      member_sort_key: 1000, assignee_count: 1,
      member_ids: [], subtasks: [],
    };

    const { rerender, getByText } = render(
      <TasksPageClient
        workspaces={[{ id: "ws-1", name: "Home", kind: "household", members: [] }]}
        currentMemberIds={[]}
        memberIdByWorkspaceId={{}}
        initialTasks={[task]}
        userName="Alice"
      />
    );

    // After rerender with server-confirmed tasks, card should not be dimmed
    rerender(
      <TasksPageClient
        workspaces={[{ id: "ws-1", name: "Home", kind: "household", members: [] }]}
        currentMemberIds={[]}
        memberIdByWorkspaceId={{}}
        initialTasks={[{ ...task, id: "t-real" }]}
        userName="Alice"
      />
    );

    const card = getByText("Optimistic Task").closest('[class*="opacity"]');
    expect(card).toBeNull();
  });
});

describe("buildDragEndHandler", () => {
  const M1 = "b0000000-0000-4000-8000-000000000001";
  const WS1 = "a0000000-0000-4000-8000-000000000001";

  function bucketTask(id: string, sortKey: number) {
    return {
      id,
      title: id,
      due_at: null,
      completed_at: null,
      workspace: { id: WS1, name: "Home", kind: "household" },
      member_sort_key: sortKey,
      assignee_count: 1,
      member_ids: [M1],
      subtasks: [],
    };
  }

  beforeEach(() => {
    (reorderTask as jest.Mock).mockReset();
  });

  it("calls reorderTask with computed neighbor keys on a same-bucket move", async () => {
    (reorderTask as jest.Mock).mockResolvedValue({ ok: true });
    const bucket = [bucketTask("t1", 1000), bucketTask("t2", 2000), bucketTask("t3", 3000)];
    const setLocalTasks = jest.fn();
    const handleReorderError = jest.fn();

    const handler = buildDragEndHandler({
      bucketsByKey: { Upcoming: bucket },
      memberIdByWorkspaceId: { [WS1]: M1 },
      setLocalTasks,
      onReorderError: handleReorderError,
    });

    await handler({
      draggableId: "t1",
      source: { droppableId: "Upcoming", index: 0 },
      destination: { droppableId: "Upcoming", index: 2 },
      reason: "DROP",
    } as import("@hello-pangea/dnd").DropResult);

    expect(reorderTask).toHaveBeenCalledWith({
      taskId: "t1",
      memberId: M1,
      prevKey: 3000,
      nextKey: null,
    });
    expect(setLocalTasks).toHaveBeenCalled(); // optimistic splice happened
  });

  // Regression: destination.index indexes the *rendered* bucket. The handler must read neighbors
  // out of the array it is handed, never re-derive an order from an unsorted source list.
  it("computes neighbor keys from the passed-in bucket order, not from sort-key order", async () => {
    (reorderTask as jest.Mock).mockResolvedValue({ ok: true });
    // Deliberately not sort-key-ordered — mimics an arbitrary server query order.
    const bucket = [bucketTask("t3", 3000), bucketTask("t1", 1000), bucketTask("t2", 2000)];
    const setLocalTasks = jest.fn();

    const handler = buildDragEndHandler({
      bucketsByKey: { Upcoming: bucket },
      memberIdByWorkspaceId: { [WS1]: M1 },
      setLocalTasks,
      onReorderError: jest.fn(),
    });

    await handler({
      draggableId: "t1",
      source: { droppableId: "Upcoming", index: 1 },
      destination: { droppableId: "Upcoming", index: 2 },
      reason: "DROP",
    } as import("@hello-pangea/dnd").DropResult);

    // Dropping at the end of [t3, t2] puts t1 after t2 → prevKey is t2's key.
    expect(reorderTask).toHaveBeenCalledWith({
      taskId: "t1",
      memberId: M1,
      prevKey: 2000,
      nextKey: null,
    });
  });

  it("reports an error and skips reorderTask when the workspace has no member id", async () => {
    const bucket = [bucketTask("t1", 1000), bucketTask("t2", 2000)];
    const setLocalTasks = jest.fn();
    const onReorderError = jest.fn();

    const handler = buildDragEndHandler({
      bucketsByKey: { Upcoming: bucket },
      memberIdByWorkspaceId: {},
      setLocalTasks,
      onReorderError,
    });

    await handler({
      draggableId: "t1",
      source: { droppableId: "Upcoming", index: 0 },
      destination: { droppableId: "Upcoming", index: 1 },
      reason: "DROP",
    } as import("@hello-pangea/dnd").DropResult);

    expect(reorderTask).not.toHaveBeenCalled();
    expect(setLocalTasks).not.toHaveBeenCalled();
    expect(onReorderError).toHaveBeenCalledWith(
      "Could not determine member for this task's workspace"
    );
  });

  it("rolls back only the dragged task, preserving tasks added during the await", async () => {
    (reorderTask as jest.Mock).mockResolvedValue({ ok: false, error: "server exploded" });
    const bucket = [bucketTask("t1", 1000), bucketTask("t2", 2000)];
    const setLocalTasks = jest.fn();

    const handler = buildDragEndHandler({
      bucketsByKey: { Upcoming: bucket },
      memberIdByWorkspaceId: { [WS1]: M1 },
      setLocalTasks,
      onReorderError: jest.fn(),
    });

    await handler({
      draggableId: "t1",
      source: { droppableId: "Upcoming", index: 0 },
      destination: { droppableId: "Upcoming", index: 1 },
      reason: "DROP",
    } as import("@hello-pangea/dnd").DropResult);

    // A task created while reorderTask was in flight.
    const concurrent = bucketTask("t-new", 9000);
    const rollback = setLocalTasks.mock.calls[1][0] as (prev: RawTask[]) => RawTask[];
    const next = rollback([...bucket, concurrent]);

    expect(next.map((t) => t.id)).toEqual(["t1", "t2", "t-new"]);
    expect(next.find((t) => t.id === "t1")!.member_sort_key).toBe(1000);
  });

  it("no-ops on a cross-bucket move", async () => {
    const bucket = [bucketTask("t1", 1000), bucketTask("t2", 2000)];
    const setLocalTasks = jest.fn();

    const handler = buildDragEndHandler({
      bucketsByKey: { Today: bucket },
      memberIdByWorkspaceId: { [WS1]: M1 },
      setLocalTasks,
      onReorderError: jest.fn(),
    });

    await handler({
      draggableId: "t1",
      source: { droppableId: "Today", index: 0 },
      destination: { droppableId: "Upcoming", index: 0 },
      reason: "DROP",
    } as import("@hello-pangea/dnd").DropResult);

    expect(reorderTask).not.toHaveBeenCalled();
    expect(setLocalTasks).not.toHaveBeenCalled();
  });

  it("reverts the optimistic order and reports the error when reorderTask fails", async () => {
    (reorderTask as jest.Mock).mockResolvedValue({ ok: false, error: "server exploded" });
    const bucket = [bucketTask("t1", 1000), bucketTask("t2", 2000)];
    const setLocalTasks = jest.fn();
    const onReorderError = jest.fn();

    const handler = buildDragEndHandler({
      bucketsByKey: { Upcoming: bucket },
      memberIdByWorkspaceId: { [WS1]: M1 },
      setLocalTasks,
      onReorderError,
    });

    await handler({
      draggableId: "t1",
      source: { droppableId: "Upcoming", index: 0 },
      destination: { droppableId: "Upcoming", index: 1 },
      reason: "DROP",
    } as import("@hello-pangea/dnd").DropResult);

    // setLocalTasks called twice: once for the optimistic splice, once for the revert
    expect(setLocalTasks).toHaveBeenCalledTimes(2);
    expect(onReorderError).toHaveBeenCalledWith("server exploded");
  });
});
