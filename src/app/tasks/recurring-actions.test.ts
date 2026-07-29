jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { createFakeSupabase, type Tables } from "@/test/supabase-fake";
import { setTaskRecurrence } from "./recurring-actions";

beforeEach(() => jest.clearAllMocks());

// Ids must be real UUIDs — the action validates them against the schemas in ./schemas.
const WS1 = "a0000000-0000-4000-8000-000000000001";
const M1 = "b0000000-0000-4000-8000-000000000001";
const M_OUTSIDER = "b0000000-0000-4000-8000-000000000003";
const T1 = "c0000000-0000-4000-8000-000000000001";

/** M1 (the signed-in user) is assigned to T1; M_OUTSIDER is in the same workspace but not assigned. */
function seed(): Tables {
  return {
    workspace_members: [
      { id: M1, workspace_id: WS1, auth_user_id: "auth-user-1", display_name: "Alice" },
      { id: M_OUTSIDER, workspace_id: WS1, auth_user_id: "auth-user-3", display_name: "Carol" },
    ],
    tasks: [{ id: T1, workspace_id: WS1, parent_task_id: null, completed_at: null, title: "Task 1" }],
    task_assignments: [{ task_id: T1, member_id: M1, member_sort_key: 1000 }],
  };
}

function setup(options: { tables?: Tables; user?: { id: string } | null } = {}) {
  const fake = createFakeSupabase({
    tables: options.tables ?? seed(),
    user: options.user === undefined ? { id: "auth-user-1" } : options.user,
  });

  (createClient as jest.Mock).mockResolvedValue(fake);
  (createAdminClient as jest.Mock).mockReturnValue(fake);

  return fake;
}

const validInput = {
  taskId: T1,
  frequency: "daily" as const,
  intervalCount: 3,
  firstRunAt: "2026-07-30T09:00",
  dueOffsetHours: 0,
  isActive: true,
};

describe("setTaskRecurrence", () => {
  it("writes the rule through the RPC that resolves local time", async () => {
    const fake = setup();
    const rpcSpy = jest.spyOn(fake, "rpc");

    const result = await setTaskRecurrence(validInput);

    expect(result.ok).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith("upsert_task_recurrence", {
      p_task_id: T1,
      p_frequency: "daily",
      p_interval_count: 3,
      p_first_run_local: "2026-07-30T09:00",
      p_due_offset_hours: 0,
      p_is_active: true,
    });
  });

  it("authorizes the specific task before writing", async () => {
    // auth-user-3 is a member of the workspace but never assigned to T1.
    const fake = setup({ user: { id: "auth-user-3" } });
    const rpcSpy = jest.spyOn(fake, "rpc");

    const result = await setTaskRecurrence(validInput);

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Forbidden") });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid input before authorizing", async () => {
    const fake = setup();
    const rpcSpy = jest.spyOn(fake, "rpc");

    const result = await setTaskRecurrence({ ...validInput, intervalCount: 0 });

    expect(result.ok).toBe(false);
    expect(rpcSpy).not.toHaveBeenCalled();
    // Proves the property (nothing was written), not just the mechanism (the RPC wasn't invoked) —
    // this would still catch a refactor to a direct insert that bypassed the RPC entirely.
    expect(fake.tables.task_rules ?? []).toHaveLength(0);
  });

  it("passes a paused rule through as is_active false", async () => {
    const fake = setup();
    const rpcSpy = jest.spyOn(fake, "rpc");

    await setTaskRecurrence({ ...validInput, isActive: false });

    expect(rpcSpy).toHaveBeenCalledWith(
      "upsert_task_recurrence",
      expect.objectContaining({ p_is_active: false })
    );
  });

  it("reports a database failure without leaking its message", async () => {
    const fake = setup();
    jest
      .spyOn(fake, "rpc")
      .mockResolvedValueOnce({ data: null, error: { message: 'relation "task_rules" does not exist' } });
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await setTaskRecurrence(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("task_rules");
    }
    logged.mockRestore();
  });

  it("revalidates /tasks on success", async () => {
    setup();

    await setTaskRecurrence(validInput);

    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });
});
