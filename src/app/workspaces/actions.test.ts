jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { createFakeSupabase, type Row, type Tables } from "@/test/supabase-fake";
import { createWorkspace, joinWorkspaceByDirectory, leaveWorkspace } from "./actions";

beforeEach(() => jest.clearAllMocks());

const WS1 = "a0000000-0000-4000-8000-000000000001";
const USER = { id: "user-1", email: "alice@example.com", user_metadata: { name: "Alice" } };

function seed(): Tables {
  return {
    workspaces: [{ id: WS1, name: "Home", kind: "household" }],
    workspace_members: [],
  };
}

function setup(options: { tables?: Tables; user?: object | null } = {}) {
  const fake = createFakeSupabase({
    tables: options.tables ?? seed(),
    user: (options.user === undefined ? USER : options.user) as { id: string } | null,
  });

  (createClient as jest.Mock).mockResolvedValue(fake);
  return fake;
}

const membersIn = (t: Tables) => t.workspace_members as Row[];
const workspacesIn = (t: Tables) => t.workspaces as Row[];

describe("createWorkspace", () => {
  it("inserts workspace (no PIN) + owner member and returns { id, name, kind }", async () => {
    const { tables } = setup();

    const result = await createWorkspace("My Home", "household");

    const created = workspacesIn(tables).find((w) => w.name === "My Home");
    expect(created).toMatchObject({ kind: "household" });
    expect(created).not.toHaveProperty("join_pin");
    expect(membersIn(tables)).toContainEqual(
      expect.objectContaining({
        workspace_id: created!.id,
        auth_user_id: "user-1",
        display_name: "Alice",
        role: "owner",
      })
    );
    expect(result).toEqual({ id: created!.id, name: "My Home", kind: "household" });
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("throws when workspace name is empty", async () => {
    setup();
    await expect(createWorkspace("", "work")).rejects.toThrow("Workspace name is required");
  });

  it("throws when workspace name is only whitespace", async () => {
    setup();
    await expect(createWorkspace("   ", "work")).rejects.toThrow("Workspace name is required");
  });

  it("throws when user is not authenticated", async () => {
    setup({ user: null });
    await expect(createWorkspace("Home", "household")).rejects.toThrow("Not authenticated");
  });

  it("derives display name from email when user_metadata.name is absent", async () => {
    const { tables } = setup({
      user: { id: "user-3", email: "charlie@example.com", user_metadata: {} },
    });

    await createWorkspace("Work", "work");

    expect(membersIn(tables)).toContainEqual(
      expect.objectContaining({ display_name: "charlie" })
    );
  });
});

describe("joinWorkspaceByDirectory", () => {
  it("looks the workspace up by id and inserts a member row", async () => {
    const { tables } = setup();

    const result = await joinWorkspaceByDirectory(WS1);

    expect(membersIn(tables)).toContainEqual(
      expect.objectContaining({
        workspace_id: WS1,
        auth_user_id: "user-1",
        display_name: "Alice",
      })
    );
    expect(result).toEqual({ workspaceName: "Home" });
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("throws when workspace not found", async () => {
    setup();
    await expect(
      joinWorkspaceByDirectory("a0000000-0000-4000-8000-00000000ffff")
    ).rejects.toThrow("Workspace not found");
  });

  it("throws when user is already a member", async () => {
    const tables = seed();
    tables.workspace_members.push({
      id: "m-1",
      workspace_id: WS1,
      auth_user_id: "user-1",
      display_name: "Alice",
    });
    setup({ tables });

    await expect(joinWorkspaceByDirectory(WS1)).rejects.toThrow(
      "You are already a member of this workspace"
    );
    expect(membersIn(tables)).toHaveLength(1);
  });

  it("throws when not authenticated", async () => {
    setup({ user: null });
    await expect(joinWorkspaceByDirectory(WS1)).rejects.toThrow("Not authenticated");
  });
});

describe("leaveWorkspace", () => {
  it("removes only the caller's own membership row", async () => {
    const tables = seed();
    tables.workspace_members.push(
      { id: "m-1", workspace_id: WS1, auth_user_id: "user-1", display_name: "Alice" },
      { id: "m-2", workspace_id: WS1, auth_user_id: "user-2", display_name: "Bob" }
    );
    setup({ tables });

    await leaveWorkspace(WS1);

    expect(membersIn(tables)).toEqual([expect.objectContaining({ auth_user_id: "user-2" })]);
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("throws when not authenticated", async () => {
    const tables = seed();
    tables.workspace_members.push({
      id: "m-1",
      workspace_id: WS1,
      auth_user_id: "user-1",
      display_name: "Alice",
    });
    setup({ tables, user: null });

    await expect(leaveWorkspace(WS1)).rejects.toThrow("Not authenticated");
    expect(membersIn(tables)).toHaveLength(1);
  });
});
