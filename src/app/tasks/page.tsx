import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RawTask } from "./bucket-tasks";
import { TasksPageClient } from "./tasks-page-client";

type SearchParams = Promise<{ workspace?: string; view?: string }>;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { workspace: workspaceFilter, view: viewFilter } = await searchParams;

  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Query 1a: get current user's own member rows first (admin bypasses self-referential RLS)
  const { data: myOwnMembers } = user
    ? await admin
        .from("workspace_members")
        .select("id, workspace_id")
        .eq("auth_user_id", user.id)
    : { data: [] };

  const myWorkspaceIds = (myOwnMembers ?? []).map((m) => m.workspace_id);

  // Query 1a': all members in the user's workspaces (for shared-task display)
  const { data: allMembers } = myWorkspaceIds.length
    ? await admin
        .from("workspace_members")
        .select("id, workspace_id, auth_user_id, display_name")
        .in("workspace_id", myWorkspaceIds)
    : { data: [] };

  // Query 1b: workspaces the current user belongs to
  const { data: workspacesData } = myWorkspaceIds.length
    ? await admin
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
  // Admin client: task_assignments_select policy is self-referential (42P17 recursion).
  // App-level security: filtered to myMemberIds (the current user's own member rows).
  const { data: myAssignments } = myMemberIds.length
    ? await admin
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
  // Admin client: tasks_select policy queries task_assignments + workspace_members (both recursive).
  // App-level security: filtered to myTaskIds derived from user's own assignments above.
  const { data: tasksData } = myTaskIds.length
    ? await admin
        .from("tasks")
        .select("id, title, due_at, completed_at, parent_task_id, workspace_id")
        .in("id", myTaskIds)
        .is("parent_task_id", null)
    : { data: [] };

  // Query 3b: all assignments for these tasks (for assignee count / shared detection)
  const { data: allAssignments } = myTaskIds.length
    ? await admin
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
      member_ids: [],   // populated in Task 4
      subtasks: [],     // populated in Task 4
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
