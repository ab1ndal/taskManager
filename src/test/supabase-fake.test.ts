import { createFakeSupabase } from "./supabase-fake";

describe("createFakeSupabase — rpc", () => {
  it("next_sort_key returns max(member_sort_key) + 1000 for a member with existing rows", async () => {
    const fake = createFakeSupabase({
      tables: {
        task_assignments: [
          { task_id: "t1", member_id: "m1", member_sort_key: 3000 },
          { task_id: "t2", member_id: "m1", member_sort_key: 1000 },
          { task_id: "t3", member_id: "m2", member_sort_key: 9000 },
        ],
      },
    });

    const { data, error } = await fake.rpc("next_sort_key", { p_member_id: "m1" });

    expect(error).toBeNull();
    expect(data).toBe(4000);
  });

  it("next_sort_key returns 1000 for a member with no existing rows", async () => {
    const fake = createFakeSupabase({ tables: { task_assignments: [] } });

    const { data, error } = await fake.rpc("next_sort_key", { p_member_id: "m-new" });

    expect(error).toBeNull();
    expect(data).toBe(1000);
  });

  it("returns an error for an unknown rpc name", async () => {
    const fake = createFakeSupabase({ tables: {} });

    const { data, error } = await fake.rpc("not_a_real_function", {});

    expect(data).toBeNull();
    expect(error).toEqual({ message: expect.stringContaining("not_a_real_function") });
  });
});
