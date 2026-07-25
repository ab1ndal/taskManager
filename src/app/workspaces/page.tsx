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
  const supabase = await createClient();

  // The directory is deliberately visible to every signed-in user — that is what workspaces_select
  // (migration 007) allows, and it is how someone finds a workspace to join.
  const { data: allWorkspaces } = await supabase
    .from("workspaces")
    .select("id, name, kind")
    .order("name");

  // Member counts are the one thing RLS cannot provide here: workspace_members_select only exposes
  // rows in workspaces you already belong to, so the count would read 0 for exactly the workspaces
  // a user is trying to discover. This query is scoped to a single non-identifying column and is
  // the only remaining service-role read on this page.
  const admin = createAdminClient();
  const { data: memberRows } = await admin.from("workspace_members").select("workspace_id");

  const memberCounts = new Map<string, number>();
  (memberRows ?? []).forEach((m) => {
    const id = m.workspace_id as string;
    memberCounts.set(id, (memberCounts.get(id) ?? 0) + 1);
  });

  const workspaces: WorkspaceRow[] = (allWorkspaces ?? []).map((ws) => ({
    id: ws.id,
    name: ws.name,
    kind: ws.kind,
    member_count: memberCounts.get(ws.id) ?? 0,
  }));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: userMembers } = user
    ? await supabase.from("workspace_members").select("workspace_id").eq("auth_user_id", user.id)
    : { data: [] };

  const joinedIds = new Set((userMembers ?? []).map((m) => m.workspace_id));

  return (
    <div className="max-w-lg">
      <WorkspacesClient workspaces={workspaces} joinedIds={joinedIds} />
    </div>
  );
}
