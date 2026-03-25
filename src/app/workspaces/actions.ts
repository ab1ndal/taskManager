"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

function generatePin(): string {
  return Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
}

export async function createWorkspace(
  name: string,
  kind: string
): Promise<{ id: string; name: string; kind: string; join_pin: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Try to insert with a unique pin, retry on conflict
  let workspace: { id: string; name: string; kind: string; join_pin: string } | null = null;
  for (let i = 0; i < 5; i++) {
    const pin = generatePin();
    const { data, error } = await supabase
      .from("workspaces")
      .insert({ name: name.trim(), kind, join_pin: pin })
      .select("id, name, kind, join_pin")
      .single();
    if (!error && data) {
      workspace = data;
      break;
    }
    if (error?.code !== "23505") throw error; // 23505 = unique violation
  }
  if (!workspace) throw new Error("Failed to generate unique pin");

  // Add creator as member
  const displayName =
    (user.user_metadata?.name as string | undefined)?.trim() ||
    user.email?.split("@")[0] ||
    "Member";
  await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    auth_user_id: user.id,
    display_name: displayName,
    role: "owner",
  });

  revalidatePath("/workspaces");
  revalidatePath("/tasks");
  return workspace;
}

export async function joinWorkspaceByPin(
  pin: string,
  displayName: string
): Promise<{ workspaceName: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Look up workspace using admin client (user is not a member yet, so RLS blocks SELECT)
  const admin = createAdminClient();
  const { data: workspace } = await admin
    .from("workspaces")
    .select("id, name")
    .eq("join_pin", pin.trim())
    .single();

  if (!workspace) throw new Error("Invalid pin — no workspace found");

  // Check already a member
  const { data: existing } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (existing) throw new Error("You are already a member of this workspace");

  // Insert member record using regular client (workspace_members_insert_self policy)
  const { error } = await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    auth_user_id: user.id,
    display_name: displayName.trim(),
  });
  if (error) throw error;

  revalidatePath("/workspaces");
  revalidatePath("/tasks");
  return { workspaceName: workspace.name };
}
