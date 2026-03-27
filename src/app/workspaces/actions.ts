"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // Admin client avoids triggering workspaces_select RLS on RETURNING,
  // which causes 42P17 infinite recursion via the self-referential workspace_members_select policy.
  const admin = createAdminClient();
  const { data, error } = await admin
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

  // Admin client bypasses RLS: user is not yet a member, so regular SELECT returns nothing
  const admin = createAdminClient();
  const { data: workspace } = await admin
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

  // Admin client: no DELETE policy exists on workspace_members yet.
  // Auth is verified above; scope is locked to user.id.
  const admin = createAdminClient();
  const { error } = await admin
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("auth_user_id", user.id);

  if (error) throw error;

  revalidatePath("/workspaces");
  revalidatePath("/tasks");
}
