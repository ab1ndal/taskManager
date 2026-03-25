import { createClient } from "@/lib/supabase/server";
import { TaskCard, EmptyState } from "@/components/task-card";
import { bucketTasks, type RawTask } from "./bucket-tasks";
import { CompletedSection } from "./completed-section";
import { TasksPageClient } from "./tasks-page-client";

type SearchParams = Promise<{ workspace?: string; view?: string }>;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { workspace: workspaceFilter, view: viewFilter } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Query 1: all workspace members visible to current user (RLS: same workspace only)
  const { data: allMembers } = await supabase
    .from("workspace_members")
    .select("id, workspace_id, auth_user_id, display_name, workspaces(id, name, kind)");

  const myMembers = (allMembers ?? []).filter((m) => m.auth_user_id === user?.id);
  const myMemberIds = myMembers.map((m) => m.id);

  // Derive workspace map for sidebar + modal
  const workspaceMap: Record<
    string,
    { id: string; name: string; kind: string; members: { id: string; display_name: string }[] }
  > = {};
  (allMembers ?? []).forEach((m) => {
    const ws = m.workspaces as { id: string; name: string; kind: string } | null;
    if (!ws) return;
    if (!workspaceMap[ws.id]) workspaceMap[ws.id] = { ...ws, members: [] };
    workspaceMap[ws.id].members.push({ id: m.id, display_name: m.display_name });
  });
  const myWorkspaces = Object.values(workspaceMap).filter((ws) =>
    myMembers.some((m) => m.workspace_id === ws.id)
  );

  // Query 2: task assignments for current user (sort key + task IDs)
  const { data: myAssignments } = myMemberIds.length
    ? await supabase
        .from("task_assignments")
        .select("task_id, member_sort_key")
        .in("member_id", myMemberIds)
        .order("member_sort_key", { ascending: true })
    : { data: [] };

  const myTaskIds = (myAssignments ?? []).map((a) => a.task_id);
  const sortKeyByTaskId: Record<string, number> = {};
  (myAssignments ?? []).forEach((a) => {
    sortKeyByTaskId[a.task_id] = a.member_sort_key as number;
  });

  // Query 3a: full task data (RLS-filtered)
  const { data: tasksData } = myTaskIds.length
    ? await supabase
        .from("tasks")
        .select("id, title, due_at, completed_at, parent_task_id, workspace_id")
        .in("id", myTaskIds)
        .is("parent_task_id", null)
    : { data: [] };

  // Query 3b: all assignments for these tasks (for assignee count / shared detection)
  const { data: allAssignments } = myTaskIds.length
    ? await supabase
        .from("task_assignments")
        .select("task_id")
        .in("task_id", myTaskIds)
    : { data: [] };

  const assigneeCounts: Record<string, number> = {};
  (allAssignments ?? []).forEach((a) => {
    assigneeCounts[a.task_id] = (assigneeCounts[a.task_id] ?? 0) + 1;
  });

  // Shape into RawTask[]
  const rawTasks: RawTask[] = (tasksData ?? []).map((t) => {
    const ws = workspaceMap[t.workspace_id as string] ?? {
      id: t.workspace_id as string,
      name: "Unknown",
      kind: "work",
    };
    return {
      id: t.id,
      title: t.title,
      due_at: t.due_at,
      completed_at: t.completed_at,
      workspace: { id: ws.id, name: ws.name, kind: ws.kind },
      member_sort_key: sortKeyByTaskId[t.id] ?? 0,
      assignee_count: assigneeCounts[t.id] ?? 1,
    };
  });

  // Apply URL filters
  const filtered = rawTasks.filter((t) => {
    if (workspaceFilter && t.workspace.kind !== workspaceFilter) return false;
    if (viewFilter === "shared" && t.assignee_count <= 1) return false;
    return true;
  });

  const { overdue, today, upcoming, completed } = bucketTasks(filtered);
  const hasAnyTasks = overdue.length + today.length + upcoming.length + completed.length > 0;
  const name = user?.user_metadata?.name || user?.email || "there";

  return (
    <TasksPageClient
      workspaces={myWorkspaces}
      currentMemberIds={myMemberIds}
      workspaceFilter={workspaceFilter}
      viewFilter={viewFilter}
    >
      <main className="flex-1 p-6 overflow-auto">
        <h2 className="text-xl font-semibold tracking-tight mb-1">Hello, {name}</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-6">Here are your tasks.</p>

        {!hasAnyTasks ? (
          <EmptyState />
        ) : (
          <>
            {(
              [
                { key: "Overdue", tasks: overdue },
                { key: "Today", tasks: today },
                { key: "Upcoming", tasks: upcoming },
              ] as const
            ).map(({ key, tasks: sectionTasks }) => {
              if (!sectionTasks.length) return null;
              return (
                <div key={key} className="mb-6">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
                    {key}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {sectionTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        taskId={task.id}
                        title={task.title}
                        deadline={task.deadlineLabel}
                        deadlineVariant={task.deadlineVariant}
                        workspace={task.workspace.name}
                        shared={task.shared}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            <CompletedSection
              tasks={completed.map((t) => ({
                taskId: t.id,
                title: t.title,
                deadline: t.deadlineLabel,
                deadlineVariant: t.deadlineVariant,
                workspace: t.workspace.name,
                shared: t.shared,
                completed: true as const,
              }))}
            />
          </>
        )}
      </main>
    </TasksPageClient>
  );
}
