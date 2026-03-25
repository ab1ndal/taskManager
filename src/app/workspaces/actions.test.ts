jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { createWorkspace, joinWorkspaceByPin } from "./actions";

beforeEach(() => jest.clearAllMocks());

// ──────────────────────────────────────────────────────────────────────────────
// createWorkspace
// ──────────────────────────────────────────────────────────────────────────────

describe("createWorkspace", () => {
  it("inserts workspace + member and returns workspace data", async () => {
    const workspaceData = { id: "ws-1", name: "Home", kind: "household", join_pin: "123456" };

    const wsSingle = jest.fn().mockResolvedValue({ data: workspaceData, error: null });
    const wsSelect = jest.fn().mockReturnValue({ single: wsSingle });
    const wsInsert = jest.fn().mockReturnValue({ select: wsSelect });

    const memberInsert = jest.fn().mockResolvedValue({ error: null });

    const mockFrom = jest.fn()
      .mockReturnValueOnce({ insert: wsInsert })    // workspaces
      .mockReturnValueOnce({ insert: memberInsert }); // workspace_members

    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "alice@example.com", user_metadata: { name: "Alice" } } },
        }),
      },
      from: mockFrom,
    });

    const result = await createWorkspace("Home", "household");

    expect(wsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Home", kind: "household", join_pin: expect.any(String) })
    );
    expect(memberInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "ws-1",
        auth_user_id: "user-1",
        display_name: "Alice",
        role: "owner",
      })
    );
    expect(result).toEqual(workspaceData);
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
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
});

// ──────────────────────────────────────────────────────────────────────────────
// joinWorkspaceByPin — success
// ──────────────────────────────────────────────────────────────────────────────

describe("joinWorkspaceByPin", () => {
  it("looks up workspace by pin and inserts member row", async () => {
    const workspaceData = { id: "ws-1", name: "Home" };

    // Admin client: lookup workspace
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
          data: { user: { id: "user-2", email: "bob@example.com", user_metadata: {} } },
        }),
      },
      from: mockFrom,
    });

    const result = await joinWorkspaceByPin("123456", "Bob");

    expect(adminEq).toHaveBeenCalledWith("join_pin", "123456");
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

    await expect(joinWorkspaceByPin("123456", "Bob")).rejects.toThrow(
      "You are already a member of this workspace"
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// joinWorkspaceByPin — invalid pin
// ──────────────────────────────────────────────────────────────────────────────

describe("joinWorkspaceByPin invalid pin", () => {
  it("throws when workspace not found", async () => {
    // Admin client returns null (no workspace for that pin)
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

    await expect(joinWorkspaceByPin("000000", "Bob")).rejects.toThrow(
      "Invalid pin — no workspace found"
    );
  });
});
