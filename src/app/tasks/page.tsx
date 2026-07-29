import { createClient } from "@/lib/supabase/server";
import type { RawTask } from "./bucket-tasks";
import { TasksPageClient } from "./tasks-page-client";
import { toLocalInputValue } from "./recurrence-time";

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

  // Every query below runs on the user-scoped client, so RLS is what decides what comes back. The
  // explicit id filters are for shaping the result, not for access control — migration 007 made the
  // policies non-recursive, which is what allowed the service-role client to be dropped from this
  // read path. Signed out, these return nothing rather than everything.

  // Query 1a: the current user's own member rows

  const { data: myOwnMembers } = user
    ? await supabase
        .from("workspace_members")
        .select("id, workspace_id")
        .eq("auth_user_id", user.id)
    : { data: [] };

  const myWorkspaceIds = (myOwnMembers ?? []).map((m) => m.workspace_id);

  // Query 1a': all members in the user's workspaces (for shared-task display)
  const { data: allMembers } = myWorkspaceIds.length
    ? await supabase
        .from("workspace_members")
        .select("id, workspace_id, auth_user_id, display_name")
        .in("workspace_id", myWorkspaceIds)
    : { data: [] };

  // Query 1b: workspaces the current user belongs to
  const { data: workspacesData } = myWorkspaceIds.length
    ? await supabase
        .from("workspaces")
        .select("id, name, kind")
        .in("id", myWorkspaceIds)
    : { data: [] };

  const myMembers = (allMembers ?? []).filter((m) => m.auth_user_id === user?.id);
  const myMemberIds = myMembers.map((m) => m.id);

  // Build a lookup from workspace id → workspace row
  const workspaceById: Record<string, { id: string; name: string; kind: string }> = {};
  (workspacesData ?? []).forEach((ws) => {
    workspaceById[ws.id] = ws;
  });

  // Derive workspace map for sidebar + modal
  const workspaceMap: Record<
    string,
    { id: string; name: string; kind: string; members: { id: string; display_name: string }[] }
  > = {};
  (allMembers ?? []).forEach((m) => {
    const ws = workspaceById[m.workspace_id];
    if (!ws) return;
    if (!workspaceMap[ws.id]) workspaceMap[ws.id] = { ...ws, members: [] };
    workspaceMap[ws.id].members.push({ id: m.id, display_name: m.display_name });
  });
  const myWorkspaces = Object.values(workspaceMap).filter((ws) =>
    myMembers.some((m) => m.workspace_id === ws.id)
  );

  const memberIdByWorkspaceId: Record<string, string> = {};
  myMembers.forEach((m) => { memberIdByWorkspaceId[m.workspace_id] = m.id; });

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

  // Query 3a: full task data
  const { data: tasksData } = myTaskIds.length
    ? await supabase
        .from("tasks")
        .select("id, title, description, due_at, completed_at, parent_task_id, workspace_id")
        .in("id", myTaskIds)
        .is("parent_task_id", null)
    : { data: [] };

  // Query 3b: all assignments for these tasks (for assignee count / shared detection)
  const { data: allAssignments } = myTaskIds.length
    ? await supabase
        .from("task_assignments")
        .select("task_id, member_id")
        .in("task_id", myTaskIds)
    : { data: [] };

  const assigneeCounts: Record<string, number> = {};
  const memberIdsByTaskId: Record<string, string[]> = {};
  (allAssignments ?? []).forEach((a) => {
    assigneeCounts[a.task_id] = (assigneeCounts[a.task_id] ?? 0) + 1;
    if (!memberIdsByTaskId[a.task_id]) memberIdsByTaskId[a.task_id] = [];
    memberIdsByTaskId[a.task_id].push(a.member_id as string);
  });

  // Query 3c: recurrence for these tasks. RLS scopes task_rules to tasks the user is assigned to,
  // so this needs no membership filter of its own.
  const { data: rulesData } = myTaskIds.length
    ? await supabase
        .from("task_rules")
        .select("task_id, frequency, interval_count, next_run_at, default_due_offset_hours, is_active")
        .in("task_id", myTaskIds)
        .eq("is_active", true)
    : { data: [] };

  const recurrenceByTaskId: Record<string, NonNullable<RawTask["recurrence"]>> = {};
  (rulesData ?? []).forEach((r) => {
    recurrenceByTaskId[r.task_id as string] = {
      frequency: r.frequency as "daily" | "weekly" | "monthly",
      intervalCount: r.interval_count as number,
      firstRunAt: toLocalInputValue(r.next_run_at as string),
      dueOffsetHours: (r.default_due_offset_hours as number | null) ?? null,
    };
  });

  // Query 4: subtasks for all parent tasks
  const parentTaskIds = (tasksData ?? []).map((t) => t.id);
  const { data: subtasksData } = parentTaskIds.length
    ? await supabase
        .from("tasks")
        .select("id, title, completed_at, description, due_at, parent_task_id")
        .in("parent_task_id", parentTaskIds)
    : { data: [] };

  const subtasksByParentId: Record<string, RawTask["subtasks"]> = {};
  (subtasksData ?? []).forEach((s) => {
    const pid = s.parent_task_id as string;
    if (!subtasksByParentId[pid]) subtasksByParentId[pid] = [];
    subtasksByParentId[pid].push({
      id: s.id,
      title: s.title,
      completed_at: s.completed_at,
      description: s.description ?? null,
      due_at: s.due_at ?? null,
    });
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
      description: t.description ?? null,
      due_at: t.due_at,
      completed_at: t.completed_at,
      workspace: { id: ws.id, name: ws.name, kind: ws.kind },
      member_sort_key: sortKeyByTaskId[t.id] ?? 0,
      assignee_count: assigneeCounts[t.id] ?? 1,
      member_ids: memberIdsByTaskId[t.id] ?? [],
      subtasks: subtasksByParentId[t.id] ?? [],
      recurrence: recurrenceByTaskId[t.id] ?? null,
      recurring: Boolean(recurrenceByTaskId[t.id]),
    };
  });

  const name = user?.user_metadata?.name || user?.email || "there";

  return (
    <TasksPageClient
      workspaces={myWorkspaces}
      currentMemberIds={myMemberIds}
      memberIdByWorkspaceId={memberIdByWorkspaceId}
      workspaceFilter={workspaceFilter}
      viewFilter={viewFilter}
      initialTasks={rawTasks}
      userName={name}
    />
  );
}
