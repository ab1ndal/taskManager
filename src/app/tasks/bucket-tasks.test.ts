import { bucketTasks, type RawTask } from "./bucket-tasks";

const NOW = new Date("2026-01-15T12:00:00Z");

function task(overrides: Partial<RawTask> = {}): RawTask {
  return {
    id: "t1",
    title: "Test",
    due_at: null,
    completed_at: null,
    workspace: { id: "w1", name: "Home", kind: "household" },
    member_sort_key: 1000,
    assignee_count: 1,
    ...overrides,
  };
}

describe("bucketTasks", () => {
  it("routes completed tasks to completed bucket only", () => {
    const { completed, overdue, today, upcoming } = bucketTasks(
      [task({ completed_at: "2026-01-14T10:00:00Z" })],
      NOW
    );
    expect(completed).toHaveLength(1);
    expect(overdue.length + today.length + upcoming.length).toBe(0);
  });

  it("routes past-due tasks to overdue with red variant", () => {
    const { overdue } = bucketTasks([task({ due_at: "2026-01-14T10:00:00Z" })], NOW);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].deadlineVariant).toBe("red");
  });

  it("routes tasks due within 24 h to today with yellow variant", () => {
    const { today } = bucketTasks([task({ due_at: "2026-01-16T10:00:00Z" })], NOW);
    expect(today).toHaveLength(1);
    expect(today[0].deadlineVariant).toBe("yellow");
  });

  it("routes tasks due in 5 days to upcoming with green variant", () => {
    const { upcoming } = bucketTasks([task({ due_at: "2026-01-20T12:00:00Z" })], NOW);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].deadlineVariant).toBe("green");
  });

  it("routes tasks with no deadline to upcoming with null deadlineLabel", () => {
    const { upcoming } = bucketTasks([task()], NOW);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].deadlineLabel).toBeNull();
  });

  it("sets shared=true when assignee_count > 1", () => {
    const { upcoming } = bucketTasks([task({ assignee_count: 2 })], NOW);
    expect(upcoming[0].shared).toBe(true);
  });

  it("preserves member_sort_key order within each bucket", () => {
    const { upcoming } = bucketTasks(
      [task({ id: "b", member_sort_key: 2000 }), task({ id: "a", member_sort_key: 1000 })],
      NOW
    );
    expect(upcoming.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
