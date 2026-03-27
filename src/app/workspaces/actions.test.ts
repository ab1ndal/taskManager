jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { createWorkspace, joinWorkspaceByDirectory } from "./actions";

beforeEach(() => jest.clearAllMocks());

// ──────────────────────────────────────────────────────────────────────────────
// createWorkspace
// ──────────────────────────────────────────────────────────────────────────────

describe("createWorkspace", () => {
  it("inserts workspace (no PIN) + member and returns { id, name, kind }", async () => {
    const workspaceData = { id: "ws-1", name: "My Home", kind: "household" };

    const wsSingle = jest.fn().mockResolvedValue({ data: workspaceData, error: null });
    const wsSelect = jest.fn().mockReturnValue({ single: wsSingle });
    const wsInsert = jest.fn().mockReturnValue({ select: wsSelect });

    const memberInsert = jest.fn().mockResolvedValue({ error: null });

    // createWorkspace uses admin client for workspace INSERT, regular client for member INSERT
    (createAdminClient as jest.Mock).mockReturnValue({ from: jest.fn().mockReturnValue({ insert: wsInsert }) });

    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "alice@example.com", user_metadata: { name: "Alice" } } },
        }),
      },
      from: jest.fn().mockReturnValue({ insert: memberInsert }),
    });

    const result = await createWorkspace("My Home", "household");

    // Must NOT include join_pin in the insert
    expect(wsInsert).toHaveBeenCalledWith(
      expect.not.objectContaining({ join_pin: expect.anything() })
    );
    expect(wsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My Home", kind: "household" })
    );
    expect(memberInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "ws-1",
        auth_user_id: "user-1",
        display_name: "Alice",
        role: "owner",
      })
    );
    // Return value must NOT contain join_pin
    expect(result).toEqual({ id: "ws-1", name: "My Home", kind: "household" });
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("throws when workspace name is empty", async () => {
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "alice@example.com", user_metadata: {} } },
        }),
      },
      from: jest.fn(),
    });

    await expect(createWorkspace("", "work")).rejects.toThrow("Workspace name is required");
  });

  it("throws when workspace name is only whitespace", async () => {
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "alice@example.com", user_metadata: {} } },
        }),
      },
      from: jest.fn(),
    });

    await expect(createWorkspace("   ", "work")).rejects.toThrow("Workspace name is required");
  });

  it("throws when user is not authenticated", async () => {
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: jest.fn(),
    });

    await expect(createWorkspace("Home", "household")).rejects.toThrow("Not authenticated");
  });

  it("derives display name from email when user_metadata.name is absent", async () => {
    const workspaceData = { id: "ws-2", name: "Work", kind: "work" };
    const workspaceData2 = { id: "ws-2", name: "Work", kind: "work" };
    const wsSingle = jest.fn().mockResolvedValue({ data: workspaceData2, error: null });
    const wsSelect = jest.fn().mockReturnValue({ single: wsSingle });
    const wsInsert = jest.fn().mockReturnValue({ select: wsSelect });
    const memberInsert = jest.fn().mockResolvedValue({ error: null });

    (createAdminClient as jest.Mock).mockReturnValue({ from: jest.fn().mockReturnValue({ insert: wsInsert }) });

    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-3", email: "charlie@example.com", user_metadata: {} } },
        }),
      },
      from: jest.fn().mockReturnValue({ insert: memberInsert }),
    });

    await createWorkspace("Work", "work");

    expect(memberInsert).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "charlie" })
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// joinWorkspaceByDirectory
// ──────────────────────────────────────────────────────────────────────────────

describe("joinWorkspaceByDirectory", () => {
  it("looks up workspace by ID via admin client and inserts member row", async () => {
    const workspaceData = { id: "ws-1", name: "Home" };

    // Admin client: lookup workspace by ID
    const adminSingle = jest.fn().mockResolvedValue({ data: workspaceData, error: null });
    const adminEq = jest.fn().mockReturnValue({ single: adminSingle });
    const adminSelect = jest.fn().mockReturnValue({ eq: adminEq });
    const adminFrom = jest.fn().mockReturnValue({ select: adminSelect });
    (createAdminClient as jest.Mock).mockReturnValue({ from: adminFrom });

    // Regular client: check existing membership (none), then insert
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const existingEq2 = jest.fn().mockReturnValue({ maybeSingle });
    const existingEq1 = jest.fn().mockReturnValue({ eq: existingEq2 });
    const existingSelect = jest.fn().mockReturnValue({ eq: existingEq1 });

    const memberInsert = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ select: existingSelect })  // workspace_members (check existing)
      .mockReturnValueOnce({ insert: memberInsert });   // workspace_members (insert)

    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-2", email: "bob@example.com", user_metadata: { name: "Bob" } } },
        }),
      },
      from: mockFrom,
    });

    const result = await joinWorkspaceByDirectory("ws-1");

    // Admin client must have looked up by ID (not join_pin)
    expect(adminEq).toHaveBeenCalledWith("id", "ws-1");
    expect(memberInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "ws-1",
        auth_user_id: "user-2",
        display_name: "Bob",
      })
    );
    expect(result).toEqual({ workspaceName: "Home" });
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("throws when workspace not found", async () => {
    const adminSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const adminEq = jest.fn().mockReturnValue({ single: adminSingle });
    const adminSelect = jest.fn().mockReturnValue({ eq: adminEq });
    const adminFrom = jest.fn().mockReturnValue({ select: adminSelect });
    (createAdminClient as jest.Mock).mockReturnValue({ from: adminFrom });

    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-2", email: "bob@example.com", user_metadata: {} } },
        }),
      },
      from: jest.fn(),
    });

    await expect(joinWorkspaceByDirectory("non-existent-id")).rejects.toThrow(
      "Workspace not found"
    );
  });

  it("throws when user is already a member", async () => {
    const workspaceData = { id: "ws-1", name: "Home" };

    const adminSingle = jest.fn().mockResolvedValue({ data: workspaceData, error: null });
    const adminEq = jest.fn().mockReturnValue({ single: adminSingle });
    const adminSelect = jest.fn().mockReturnValue({ eq: adminEq });
    const adminFrom = jest.fn().mockReturnValue({ select: adminSelect });
    (createAdminClient as jest.Mock).mockReturnValue({ from: adminFrom });

    // Existing member found
    const maybeSingle = jest.fn().mockResolvedValue({ data: { id: "m-1" }, error: null });
    const existingEq2 = jest.fn().mockReturnValue({ maybeSingle });
    const existingEq1 = jest.fn().mockReturnValue({ eq: existingEq2 });
    const existingSelect = jest.fn().mockReturnValue({ eq: existingEq1 });

    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-2", email: "bob@example.com", user_metadata: {} } },
        }),
      },
      from: jest.fn().mockReturnValue({ select: existingSelect }),
    });

    await expect(joinWorkspaceByDirectory("ws-1")).rejects.toThrow(
      "You are already a member of this workspace"
    );
  });

  it("throws when not authenticated", async () => {
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: jest.fn(),
    });

    await expect(joinWorkspaceByDirectory("ws-1")).rejects.toThrow("Not authenticated");
  });
});
