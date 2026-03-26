import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { WorkspacesClient } from "./workspaces-client";

type WorkspaceRow = {
  id: string;
  name: string;
  kind: string;
  member_count: number;
};

export default async function WorkspacesPage() {
  const admin = createAdminClient();
  const supabase = await createClient();

  // Fetch all workspaces with member count via LEFT JOIN aggregate
  // Admin client bypasses RLS (user can only SELECT workspaces they belong to)
  const { data: allWorkspaces } = await admin
    .from("workspaces")
    .select("id, name, kind, workspace_members(count)")
    .order("name");

  const workspaces: WorkspaceRow[] = (allWorkspaces ?? []).map((ws) => ({
    id: ws.id,
    name: ws.name,
    kind: ws.kind,
    member_count:
      Array.isArray(ws.workspace_members)
        ? (ws.workspace_members[0] as { count: number } | undefined)?.count ?? 0
        : 0,
  }));

  // Get current user's workspace memberships (regular client, RLS-filtered to own rows)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: userMembers } = user
    ? await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("auth_user_id", user.id)
    : { data: [] };

  const joinedIds = new Set((userMembers ?? []).map((m) => m.workspace_id));

  return (
    <div className="max-w-lg">
      <WorkspacesClient workspaces={workspaces} joinedIds={joinedIds} />
    </div>
  );
}
