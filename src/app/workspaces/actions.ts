"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function createWorkspace(
  name: string,
  kind: "household" | "work"
): Promise<{ id: string; name: string; kind: string }> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Workspace name is required");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Runs as the user: under migration 007 workspaces_select is `true`, so INSERT ... RETURNING
  // works and workspaces_insert is what authorizes the write.
  const { data, error } = await supabase
    .from("workspaces")
    .insert({ name: trimmedName, kind })
    .select("id, name, kind")
    .single();

  if (error) throw error;
  if (!data) throw new Error("Failed to create workspace");

  const displayName =
    (user.user_metadata?.name as string | undefined)?.trim() ||
    user.email?.split("@")[0] ||
    "Member";

  await supabase.from("workspace_members").insert({
    workspace_id: data.id,
    auth_user_id: user.id,
    display_name: displayName,
    role: "owner",
  });

  revalidatePath("/workspaces");
  revalidatePath("/tasks");
  return data;
}

export async function joinWorkspaceByDirectory(
  workspaceId: string
): Promise<{ workspaceName: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // The directory is readable by any signed-in user (workspaces_select), so a not-yet-member can
  // look up the workspace they are joining without the service-role client.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", workspaceId)
    .single();

  if (!workspace) throw new Error("Workspace not found");

  // Check for existing membership (regular client — user can see their own member rows)
  const { data: existing } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (existing) throw new Error("You are already a member of this workspace");

  const displayName =
    (user.user_metadata?.name as string | undefined)?.trim() ||
    user.email?.split("@")[0] ||
    "Member";

  const { error } = await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    auth_user_id: user.id,
    display_name: displayName,
  });

  if (error) throw error;

  revalidatePath("/workspaces");
  revalidatePath("/tasks");
  return { workspaceName: workspace.name };
}

export async function leaveWorkspace(workspaceId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // workspace_members_delete_self (migration 007) restricts this to the caller's own rows; the
  // auth_user_id filter below keeps the intent explicit rather than relying on RLS alone.
  const { error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("auth_user_id", user.id);

  if (error) throw error;

  revalidatePath("/workspaces");
  revalidatePath("/tasks");
}
