import { createFakeSupabase } from "@/test/supabase-fake";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
let fake = createFakeSupabase();

jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));
jest.mock("./category-decision", () => ({
  categoryForUnknownName: jest.fn(async () => "household"),
}));

import { categoryForUnknownName } from "./category-decision";
import { suggestGroceryCategory } from "./category-decision-action";

beforeEach(() => {
  jest.clearAllMocks();
  fake = createFakeSupabase({ tables: {
    workspace_members: [{ id: "member", workspace_id: WORKSPACE, auth_user_id: "auth-user-1" }],
    workspaces: [{ id: WORKSPACE, kind: "household" }],
  } });
});

it("returns a suggestion only for a member of a household workspace", async () => {
  await expect(suggestGroceryCategory({ workspaceId: WORKSPACE, name: "Zibble" }))
    .resolves.toMatchObject({ ok: true, category: "household" });
  expect(categoryForUnknownName).toHaveBeenCalledWith(WORKSPACE, "Zibble");
});

it("does not spend the household key for another workspace kind", async () => {
  fake.tables.workspaces![0].kind = "work";
  await expect(suggestGroceryCategory({ workspaceId: WORKSPACE, name: "Zibble" }))
    .resolves.toMatchObject({ ok: false, error: expect.stringContaining("Forbidden") });
  expect(categoryForUnknownName).not.toHaveBeenCalled();
});
