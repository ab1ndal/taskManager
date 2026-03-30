import { bucketTasks, type RawTask } from "./bucket-tasks";

function makeTask(overrides: Partial<RawTask> & { id: string }): RawTask {
  return {
    title: "Task",
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

// "now" is 2026-04-01T12:00:00Z in all tests
const NOW = new Date("2026-04-01T12:00:00Z");

describe("bucketTasks — completed", () => {
  it("routes completed tasks to completed bucket regardless of due date", () => {
    const task = makeTask({ id: "t1", due_at: "2026-04-01T00:00:00Z", completed_at: "2026-04-01T10:00:00Z" });
    const { completed, today } = bucketTasks([task], NOW);
    expect(completed).toHaveLength(1);
    expect(today).toHaveLength(0);
  });
});

describe("bucketTasks — overdue", () => {
  it("routes task with due date yesterday to overdue", () => {
    const task = makeTask({ id: "t2", due_at: "2026-03-31T00:00:00Z" });
    const { overdue } = bucketTasks([task], NOW);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].deadlineLabel).toBe("Overdue");
    expect(overdue[0].deadlineVariant).toBe("red");
  });

  it("routes task with due date 10 days ago to overdue", () => {
    const task = makeTask({ id: "t3", due_at: "2026-03-22T00:00:00Z" });
    const { overdue } = bucketTasks([task], NOW);
    expect(overdue).toHaveLength(1);
  });
});

describe("bucketTasks — today", () => {
  it("routes task due today (midnight UTC) to today bucket", () => {
    const task = makeTask({ id: "t4", due_at: "2026-04-01T00:00:00Z" });
    const { today } = bucketTasks([task], NOW);
    expect(today).toHaveLength(1);
    expect(today[0].deadlineLabel).toBe("Due today");
    expect(today[0].deadlineVariant).toBe("yellow");
  });
});

describe("bucketTasks — upcoming", () => {
  it("routes task due tomorrow to upcoming", () => {
    const task = makeTask({ id: "t5", due_at: "2026-04-02T00:00:00Z" });
    const { upcoming } = bucketTasks([task], NOW);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].deadlineLabel).toBe("Due in 1 day");
    expect(upcoming[0].deadlineVariant).toBe("green");
  });

  it("routes task due in 3 days to upcoming with correct label", () => {
    const task = makeTask({ id: "t6", due_at: "2026-04-04T00:00:00Z" });
    const { upcoming } = bucketTasks([task], NOW);
    expect(upcoming[0].deadlineLabel).toBe("Due in 3 days");
  });

  it("routes task with no due date to upcoming with no label", () => {
    const task = makeTask({ id: "t7" });
    const { upcoming } = bucketTasks([task], NOW);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].deadlineLabel).toBeNull();
  });
});

describe("bucketTasks — sorting", () => {
  it("sorts tasks by member_sort_key within each bucket", () => {
    const a = makeTask({ id: "a", due_at: null, member_sort_key: 2000 });
    const b = makeTask({ id: "b", due_at: null, member_sort_key: 1000 });
    const { upcoming } = bucketTasks([a, b], NOW);
    expect(upcoming[0].id).toBe("b");
    expect(upcoming[1].id).toBe("a");
  });
});
