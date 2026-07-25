import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server actions are public endpoints — a caller can invoke one with any argument they like, and
 * nothing in the UI constrains them. Every action therefore needs two checks: that the caller is
 * authenticated, and that they are authorized for the specific row they named.
 *
 * The assertions below deliberately use the admin client. They must give the same answer whether or
 * not migration 007 has been applied: before it, RLS is permissive and would wave everything
 * through; after it, RLS agrees with these checks and acts as defense in depth. Reading through RLS
 * here would make the guard vacuous on an un-migrated database.
 *
 * See tasks/lessons.md L4.
 */

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(detail: string) {
    super(`Forbidden: ${detail}`);
    this.name = "ForbiddenError";
  }
}

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new UnauthorizedError();

  return { supabase, user };
}

/** The current user's workspace_members row ids, across every workspace they belong to. */
export async function memberIdsForUser(authUserId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workspace_members")
    .select("id")
    .eq("auth_user_id", authUserId);

  if (error) throw new Error(`Failed to load membership: ${error.message}`);

  return (data ?? []).map((m) => m.id as string);
}

/** Throws unless the user is assigned to this task. Assignment is the visibility rule. */
export async function assertTaskAssignee(taskId: string, authUserId: string): Promise<void> {
  const memberIds = await memberIdsForUser(authUserId);
  if (memberIds.length === 0) throw new ForbiddenError(`not assigned to task ${taskId}`);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("task_assignments")
    .select("task_id")
    .eq("task_id", taskId)
    .in("member_id", memberIds)
    .limit(1);

  if (error) throw new Error(`Failed to verify task access: ${error.message}`);
  if (!data || data.length === 0) throw new ForbiddenError(`not assigned to task ${taskId}`);
}

/** Throws unless the user belongs to this workspace. */
export async function assertWorkspaceMember(
  workspaceId: string,
  authUserId: string
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("auth_user_id", authUserId)
    .limit(1);

  if (error) throw new Error(`Failed to verify workspace access: ${error.message}`);
  if (!data || data.length === 0) {
    throw new ForbiddenError(`not a member of workspace ${workspaceId}`);
  }
}

/**
 * Throws unless every member id belongs to this workspace. Without this check a caller can name an
 * arbitrary workspace_members row and assign a task to someone in a workspace they have nothing to
 * do with.
 */
export async function assertMembersInWorkspace(
  memberIds: string[],
  workspaceId: string
): Promise<void> {
  if (memberIds.length === 0) return;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("id", memberIds);

  if (error) throw new Error(`Failed to verify members: ${error.message}`);

  const found = new Set((data ?? []).map((m) => m.id as string));
  const stray = memberIds.filter((id) => !found.has(id));
  if (stray.length > 0) {
    throw new ForbiddenError(`members not in workspace ${workspaceId}: ${stray.join(", ")}`);
  }
}
