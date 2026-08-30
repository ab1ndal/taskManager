import { createClient } from "@/lib/supabase/server";
import { BoardClient } from "./board-client";
import type { BoardColumn, BoardTask } from "./group-columns";
import type { Tab20Slug } from "./colors";
import { DONE_WINDOW_DAYS } from "./group-columns";

type SearchParams = Promise<{ workspace?: string }>;

export default async function BoardPage({ searchParams }: { searchParams: SearchParams }) {
  const { workspace: workspaceFilter } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Every query below runs on the user-scoped client, so RLS is what decides what comes back. The
  // id filters shape the result rather than guard it — same posture as /tasks.
  const { data: myMembers } = user
    ? await supabase
        .from("workspace_members")
        .select("id, workspace_id")
        .eq("auth_user_id", user.id)
    : { data: [] };

  const allMyWorkspaceIds = (myMembers ?? []).map((m) => m.workspace_id as string);
  const workspaceIds = workspaceFilter
    ? allMyWorkspaceIds.filter((id) => id === workspaceFilter)
    : allMyWorkspaceIds;

  if (workspaceIds.length === 0) {
    return (
      <main className="p-6">
        <h1 className="mb-2 text-xl font-semibold tracking-tight">Board</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Join or create a workspace to use the board.
        </p>
      </main>
    );
  }

  const memberIdByWorkspaceId: Record<string, string> = {};
  (myMembers ?? []).forEach((m) => {
    memberIdByWorkspaceId[m.workspace_id as string] = m.id as string;
  });

  const { data: workspaceRows } = await supabase
    .from("workspaces")
    .select("id, name, kind")
    .in("id", workspaceIds);

  const workspaceById = new Map(
    (workspaceRows ?? []).map((w) => [w.id as string, { name: w.name as string, kind: w.kind as string }])
  );

  const { data: columnRows } = await supabase
    .from("board_columns")
    .select("id, workspace_id, name, color, position, is_done")
    .in("workspace_id", workspaceIds)
    .order("position", { ascending: true });

  const columns: BoardColumn[] = (columnRows ?? []).map((c) => ({
    id: c.id as string,
    workspaceId: c.workspace_id as string,
    name: c.name as string,
    color: c.color as Tab20Slug,
    position: c.position as number,
    isDone: c.is_done as boolean,
  }));

  // Visibility is assignment, and ordering is per user, so the caller's assignment rows come first.
  const myMemberIds = (myMembers ?? []).map((m) => m.id as string);
  const { data: myAssignments } = await supabase
    .from("task_assignments")
    .select("task_id, member_sort_key")
    .in("member_id", myMemberIds);

  const sortKeyByTaskId = new Map(
    (myAssignments ?? []).map((a) => [a.task_id as string, a.member_sort_key as number])
  );
  const myTaskIds = [...sortKeyByTaskId.keys()];

  // Completed work older than the done window is fetched on demand by loadOlderDone, so the initial
  // query stays bounded however long the history is.
  const doneCutoff = new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000).toISOString();

  const { data: taskRows } = myTaskIds.length
    ? await supabase
        .from("tasks")
        .select("id, title, due_at, completed_at, workspace_id, board_column_id")
        .in("id", myTaskIds)
        .in("workspace_id", workspaceIds)
        .is("parent_task_id", null)
        .or(`completed_at.is.null,completed_at.gte.${doneCutoff}`)
    : { data: [] };

  const { data: allAssignments } = myTaskIds.length
    ? await supabase.from("task_assignments").select("task_id, member_id").in("task_id", myTaskIds)
    : { data: [] };

  const assigneeCounts = new Map<string, number>();
  (allAssignments ?? []).forEach((a) => {
    const id = a.task_id as string;
    assigneeCounts.set(id, (assigneeCounts.get(id) ?? 0) + 1);
  });

  const tasks: BoardTask[] = (taskRows ?? []).map((t) => {
    const workspaceId = t.workspace_id as string;
    const workspace = workspaceById.get(workspaceId);
    return {
      id: t.id as string,
      title: t.title as string,
      dueAt: (t.due_at as string | null) ?? null,
      completedAt: (t.completed_at as string | null) ?? null,
      workspaceId,
      workspaceName: workspace?.name ?? "",
      workspaceKind: workspace?.kind ?? "",
      boardColumnId: t.board_column_id as string,
      memberSortKey: sortKeyByTaskId.get(t.id as string) ?? 0,
      assigneeCount: assigneeCounts.get(t.id as string) ?? 1,
    };
  });

  return (
    <main>
      <h1 className="px-4 pt-6 text-xl font-semibold tracking-tight">Board</h1>
      <BoardClient
        columns={columns}
        tasks={tasks}
        memberIdByWorkspaceId={memberIdByWorkspaceId}
        workspaceIds={workspaceIds}
        showWorkspace={workspaceIds.length > 1}
      />
    </main>
  );
}
