export type RawTask = {
  id: string;
  title: string;
  description?: string | null;
  due_at: string | null;
  completed_at: string | null;
  workspace: { id: string; name: string; kind: string };
  member_sort_key: number;
  assignee_count: number;
  member_ids: string[];
  subtasks: { id: string; title: string; completed_at: string | null }[];
  rule_id?: string | null;
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

function toDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function bucketTasks(tasks: RawTask[], now: Date = new Date()): TaskBuckets {
  const sorted = [...tasks].sort((a, b) => a.member_sort_key - b.member_sort_key);
  const buckets: TaskBuckets = { overdue: [], today: [], upcoming: [], completed: [] };
  const todayStr = toDateStr(now);

  for (const raw of sorted) {
    const t: BucketedTask = { ...raw, shared: raw.assignee_count > 1, deadlineLabel: null, deadlineVariant: null };

    if (raw.completed_at) {
      buckets.completed.push(t);
      continue;
    }

    if (!raw.due_at) {
      buckets.upcoming.push(t);
      continue;
    }

    const dueStr = toDateStr(new Date(raw.due_at));

    if (dueStr < todayStr) {
      t.deadlineLabel = "Overdue";
      t.deadlineVariant = "red";
      buckets.overdue.push(t);
    } else if (dueStr === todayStr) {
      t.deadlineLabel = "Due today";
      t.deadlineVariant = "yellow";
      buckets.today.push(t);
    } else {
      const todayMidnight = new Date(`${todayStr}T00:00:00Z`);
      const dueMidnight = new Date(`${dueStr}T00:00:00Z`);
      const days = Math.round((dueMidnight.getTime() - todayMidnight.getTime()) / (24 * 60 * 60 * 1000));
      t.deadlineLabel = `Due in ${days} day${days !== 1 ? "s" : ""}`;
      t.deadlineVariant = "green";
      buckets.upcoming.push(t);
    }
  }

  return buckets;
}
