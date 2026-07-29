import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Next loads `.env` itself, but this module also runs outside Next (global setup/teardown), so it
 * reads the file directly. Hand-parsed rather than pulling in `dotenv` for four lines — a new
 * dependency is attack surface.
 */
function loadEnv() {
  // Same precedence Next uses: `.env.local` wins over `.env.production`, so the local/test project
  // is what a local run gets even though `next build` runs in production mode.
  for (const file of [".env.local", ".env", ".env.production"]) {
    let contents: string;
    try {
      contents = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    for (const line of contents.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

/**
 * Everything this harness creates carries this prefix, and teardown deletes by it. Nothing here
 * touches a row it did not create.
 */
export const E2E_TAG = "e2e-phase65";

export const TEST_USER = {
  email: `${E2E_TAG}@example.com`,
  password: "e2e-phase65-pw",
  name: "Test Runner",
};

/** A second member, so "Shared" tasks and the assignee list have something real to show. */
export const OTHER_USER = {
  email: `${E2E_TAG}-other@example.com`,
  password: "e2e-phase65-pw",
  name: "Second Member",
};

export const WORKSPACE_NAME = `${E2E_TAG} Household`;

/**
 * The suite seeds and deletes rows, so it must never run against the production project.
 *
 * Local development and the tests share one throwaway project (decided 2026-07-27), so there is no
 * URL difference between "the app" and "the tests" to check. `E2E_SUPABASE_URL` is instead an
 * explicit declaration, written once in `.env.local`, that says *this project is disposable*. The
 * production project's env — `.env.production`, and the GitHub and Vercel variables — never carries
 * it, so a run that picks those up fails here instead of seeding.
 *
 * Teardown is still scoped by tag, so ordinary local data in the shared project survives a run: it
 * deletes the `e2e-phase65 Household` workspace and the two `e2e-phase65@…` users, nothing else.
 */
function assertTestProject(url: string): void {
  const allowed = process.env.E2E_SUPABASE_URL;

  if (!allowed) {
    throw new Error(
      "E2E_SUPABASE_URL is not set. It declares which project the suite may seed and delete in; " +
        "add it to .env.local pointing at the throwaway project. It is deliberately absent from " +
        "production env, so this is what stops a run against real data."
    );
  }

  if (url !== allowed) {
    throw new Error(
      `Refusing to run: the app is pointed at ${url}, but the project declared disposable is ` +
        `${allowed}. This suite seeds and deletes rows.`
    );
  }
}

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set to run e2e");
  }
  assertTestProject(url);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function findUserByEmail(admin: SupabaseClient, email: string) {
  // listUsers has no email filter; the harness only ever creates two, so one page is enough.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === email) ?? null;
}

async function ensureUser(admin: SupabaseClient, spec: typeof TEST_USER) {
  const existing = await findUserByEmail(admin, spec.email);
  if (existing) return existing;
  const { data, error } = await admin.auth.admin.createUser({
    email: spec.email,
    password: spec.password,
    email_confirm: true,
    user_metadata: { name: spec.name },
  });
  if (error) throw error;
  return data.user;
}

export type SeedResult = {
  workspaceId: string;
  memberId: string;
  otherMemberId: string;
  taskIds: string[];
};

/**
 * Seeds one workspace with two members and a task in each deadline bucket, plus a shared task,
 * subtasks, a completed task, an update thread, and one deliberately long title — the case that
 * truncated to "Renew t…" on a phone.
 */
export async function seed(): Promise<SeedResult> {
  const admin = adminClient();
  await teardown(); // a previous interrupted run must not leave duplicates behind

  const user = await ensureUser(admin, TEST_USER);
  const other = await ensureUser(admin, OTHER_USER);

  const { data: ws, error: wsErr } = await admin
    .from("workspaces")
    .insert({ name: WORKSPACE_NAME, kind: "household" })
    .select("id")
    .single();
  if (wsErr) throw wsErr;

  const { data: members, error: memErr } = await admin
    .from("workspace_members")
    .insert([
      { workspace_id: ws.id, auth_user_id: user.id, display_name: TEST_USER.name },
      { workspace_id: ws.id, auth_user_id: other.id, display_name: OTHER_USER.name },
    ])
    .select("id, auth_user_id");
  if (memErr) throw memErr;

  const memberId = members.find((m) => m.auth_user_id === user.id)!.id;
  const otherMemberId = members.find((m) => m.auth_user_id === other.id)!.id;

  const taskSpecs = [
    { title: "Overdue: pay the water bill", due_at: isoDaysFromNow(-3) },
    { title: "Today: take the bins out", due_at: new Date().toISOString() },
    {
      title: "Renew the household contents insurance policy before the end of the month",
      due_at: isoDaysFromNow(5),
    },
    { title: "Shared: plan the weekend shop", due_at: isoDaysFromNow(2) },
    { title: "Done: water the plants", due_at: isoDaysFromNow(-1), completed_at: new Date().toISOString() },
  ];

  const { data: tasks, error: taskErr } = await admin
    .from("tasks")
    .insert(taskSpecs.map((t) => ({ ...t, workspace_id: ws.id, created_by_member_id: memberId })))
    .select("id, title");
  if (taskErr) throw taskErr;

  const byTitle = (needle: string) => tasks.find((t) => t.title.startsWith(needle))!.id;

  const assignments = tasks.map((t, i) => ({
    task_id: t.id,
    member_id: memberId,
    member_sort_key: (i + 1) * 1000,
  }));
  // The shared task gets a second assignee, which is what makes the "Shared" badge and tab real.
  assignments.push({
    task_id: byTitle("Shared"),
    member_id: otherMemberId,
    member_sort_key: 1000,
  });
  const { error: assignErr } = await admin.from("task_assignments").insert(assignments);
  if (assignErr) throw assignErr;

  const parentId = byTitle("Today");
  // Migration 011 normalized workspace_id to the root task only: a subtask now carries
  // parent_task_id and no workspace_id of its own (`tasks_workspace_only_on_root` rejects a row
  // that has both), so this stopped setting it once 011 was actually applied to dev.
  const { data: subtasks, error: subErr } = await admin
    .from("tasks")
    .insert([
      { parent_task_id: parentId, title: "Rinse the recycling" },
      {
        parent_task_id: parentId,
        title: "Put the bin back",
        completed_at: new Date().toISOString(),
      },
    ])
    .select("id");
  if (subErr) throw subErr;

  const { error: subAssignErr } = await admin.from("task_assignments").insert(
    subtasks.map((s, i) => ({ task_id: s.id, member_id: memberId, member_sort_key: 6000 + i }))
  );
  if (subAssignErr) throw subAssignErr;

  const { error: updErr } = await admin.from("task_updates").insert([
    { task_id: parentId, member_id: otherMemberId, update_text: "Bins were collected early today." },
    { task_id: parentId, member_id: memberId, update_text: "Noted — will put them back out tonight." },
  ]);
  if (updErr) throw updErr;

  return {
    workspaceId: ws.id,
    memberId,
    otherMemberId,
    taskIds: tasks.map((t) => t.id),
  };
}

/**
 * Removes the rows a spec wrote through the UI, leaving the seeded fixtures exactly as `seed` left
 * them. Specs that assert persistence necessarily create rows, and those rows are then visible to
 * every spec that runs after them — which is how the screenshot baselines failed in a full run
 * while passing on their own: the iPhone project runs last and saw four projects' worth of extra
 * subtasks and updates.
 *
 * Scoped to the seeded workspace and to the markers those specs use, so it cannot reach anything
 * else even if the prefixes ever appear elsewhere.
 */
export async function cleanupUiWrites(): Promise<void> {
  const admin = adminClient();

  const { data: ws } = await admin.from("workspaces").select("id").eq("name", WORKSPACE_NAME);
  const workspaceIds = (ws ?? []).map((w) => w.id);
  if (!workspaceIds.length) return;

  const { data: tasks } = await admin
    .from("tasks")
    .select("id")
    .in("workspace_id", workspaceIds);
  const taskIds = (tasks ?? []).map((t) => t.id);

  if (taskIds.length) {
    for (const prefix of ["E2E update", "Filler"]) {
      const { error } = await admin
        .from("task_updates")
        .delete()
        .in("task_id", taskIds)
        .like("update_text", `${prefix}%`);
      if (error) throw error;
    }
  }

  // Migration 011 normalized workspace_id to the root task only, so a subtask row now has
  // workspace_id = null (see the seed() note above) — it has to be found through its parent's id
  // instead of the workspace filter this used before 011 was actually applied to dev.
  if (taskIds.length) {
    const { error: taskErr } = await admin
      .from("tasks")
      .delete()
      .in("parent_task_id", taskIds)
      .like("title", "E2E subtask%");
    if (taskErr) throw taskErr;
  }

  // Recurring specs create real tasks titled `${E2E_TAG} …` through the UI. `task_rules` has
  // `task_id references tasks(id) on delete cascade` (migration 012), so deleting the task takes
  // its rule with it — a rule left behind is invisible to the spec that wrote it but still due,
  // and the live cron job (run-due-recurrences, every 15 minutes) would reactivate it later.
  const { error: recurringTaskErr } = await admin
    .from("tasks")
    .delete()
    .in("workspace_id", workspaceIds)
    .like("title", `${E2E_TAG}%`);
  if (recurringTaskErr) throw recurringTaskErr;
}

/**
 * Deletes only what the harness created. Workspace delete cascades to members, tasks, assignments
 * and updates; the auth users are removed separately since they are not owned by the workspace.
 */
export async function teardown(): Promise<void> {
  const admin = adminClient();

  const { data: workspaces } = await admin.from("workspaces").select("id").eq("name", WORKSPACE_NAME);
  for (const ws of workspaces ?? []) {
    const { error } = await admin.from("workspaces").delete().eq("id", ws.id);
    if (error) throw error;
  }

  for (const email of [TEST_USER.email, OTHER_USER.email]) {
    const existing = await findUserByEmail(admin, email);
    if (existing) {
      const { error } = await admin.auth.admin.deleteUser(existing.id);
      if (error) throw error;
    }
  }
}
