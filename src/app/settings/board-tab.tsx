import { createClient } from "@/lib/supabase/server";
import type { Tab20Slug } from "@/app/board/colors";
import type { BoardColumn } from "@/app/board/group-columns";
import { BoardColumnsEditor } from "./board-columns-editor";

/**
 * Columns are shared by a workspace's members, so this tab edits shared data. Every workspace the
 * user belongs to gets its own list, and each list's copy says plainly who else a change reaches.
 */
export async function BoardTab() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: myMembers } = user
    ? await supabase.from("workspace_members").select("workspace_id").eq("auth_user_id", user.id)
    : { data: [] };

  const workspaceIds = (myMembers ?? []).map((m) => m.workspace_id as string);

  if (workspaceIds.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        Join or create a workspace to configure board columns.
      </p>
    );
  }

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name")
    .in("id", workspaceIds)
    .order("name", { ascending: true });

  const { data: columnRows } = await supabase
    .from("board_columns")
    .select("id, workspace_id, name, color, position, is_done")
    .in("workspace_id", workspaceIds)
    .order("position", { ascending: true });

  const columnsByWorkspace = new Map<string, BoardColumn[]>();
  (columnRows ?? []).forEach((c) => {
    const workspaceId = c.workspace_id as string;
    const list = columnsByWorkspace.get(workspaceId) ?? [];
    list.push({
      id: c.id as string,
      workspaceId,
      name: c.name as string,
      color: c.color as Tab20Slug,
      position: c.position as number,
      isDone: c.is_done as boolean,
    });
    columnsByWorkspace.set(workspaceId, list);
  });

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <h2 className="text-xl font-semibold tracking-tight">Board</h2>
      {(workspaces ?? []).map((workspace) => (
        <BoardColumnsEditor
          key={workspace.id as string}
          workspaceId={workspace.id as string}
          workspaceName={workspace.name as string}
          columns={columnsByWorkspace.get(workspace.id as string) ?? []}
        />
      ))}
    </div>
  );
}
