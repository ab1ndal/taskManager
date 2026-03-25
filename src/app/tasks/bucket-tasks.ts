export type RawTask = {
  id: string;
  title: string;
  due_at: string | null;
  completed_at: string | null;
  workspace: { id: string; name: string; kind: string };
  member_sort_key: number;
  assignee_count: number;
};

export type BucketedTask = RawTask & {
  shared: boolean;
  deadlineLabel: string | null;
  deadlineVariant: "red" | "yellow" | "green" | null;
};

export type TaskBuckets = {
  overdue: BucketedTask[];
  today: BucketedTask[];
  upcoming: BucketedTask[];
  completed: BucketedTask[];
};

export function bucketTasks(tasks: RawTask[], now: Date = new Date()): TaskBuckets {
  const sorted = [...tasks].sort((a, b) => a.member_sort_key - b.member_sort_key);
  const buckets: TaskBuckets = { overdue: [], today: [], upcoming: [], completed: [] };

  for (const raw of sorted) {
    const t: BucketedTask = {
      ...raw,
      shared: raw.assignee_count > 1,
      deadlineLabel: null,
      deadlineVariant: null,
    };

    if (raw.completed_at) {
      buckets.completed.push(t);
      continue;
    }

    if (!raw.due_at) {
      buckets.upcoming.push(t);
      continue;
    }

    const msUntilDue = new Date(raw.due_at).getTime() - now.getTime();

    if (msUntilDue < 0) {
      t.deadlineLabel = "Overdue";
      t.deadlineVariant = "red";
      buckets.overdue.push(t);
    } else if (msUntilDue < 24 * 60 * 60 * 1000) {
      const hrs = Math.ceil(msUntilDue / (60 * 60 * 1000));
      t.deadlineLabel = `Due in ${hrs} hr${hrs !== 1 ? "s" : ""}`;
      t.deadlineVariant = "yellow";
      buckets.today.push(t);
    } else {
      const days = Math.ceil(msUntilDue / (24 * 60 * 60 * 1000));
      t.deadlineLabel = `Due in ${days} day${days !== 1 ? "s" : ""}`;
      t.deadlineVariant = "green";
      buckets.upcoming.push(t);
    }
  }

  return buckets;
}
