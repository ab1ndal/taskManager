import { createFakeSupabase } from "@/test/supabase-fake";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

let fake: ReturnType<typeof createFakeSupabase>;
const generateObject = jest.fn();

jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));
jest.mock("ai", () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }));
jest.mock("@ai-sdk/anthropic", () => ({ anthropic: (model: string) => model }));

import * as dictateActions from "./dictate-actions";

beforeEach(() => {
  jest.clearAllMocks();
  fake = createFakeSupabase({
    tables: { workspace_members: [{ id: "member", workspace_id: WORKSPACE, auth_user_id: "auth-user-1" }] },
  });
});

function mockModelReply(items: unknown[]) {
  generateObject.mockResolvedValue({ object: items });
}

it("maps a well-formed model reply into review rows", async () => {
  mockModelReply([
    { name: "Milk", quantity: null, category: "dairy", confidence: 0.95, sourceText: "milk" },
    { name: "Eggs", quantity: 12, category: "dairy", confidence: 0.8, sourceText: "dozen eggs" },
  ]);

  const result = await dictateActions.parseGroceryDictation({
    workspaceId: WORKSPACE,
    transcript: "milk, dozen eggs",
  });

  expect(result).toMatchObject({
    ok: true,
    items: [
      { name: "Milk", quantity: null, category: "dairy", confidence: 0.95, lowConfidence: false },
      { name: "Eggs", quantity: 12, category: "dairy", confidence: 0.8, lowConfidence: false },
    ],
  });
});

it("falls back to pantry for a category the model invented", async () => {
  mockModelReply([{ name: "Chicken", quantity: null, category: "meat", confidence: 0.9, sourceText: "chicken" }]);

  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "chicken" });

  expect(result).toMatchObject({ ok: true, items: [{ category: "pantry" }] });
});

it("flags a low-confidence row instead of dropping it", async () => {
  mockModelReply([
    { name: "olive oil", quantity: null, category: "pantry", confidence: 0.3, sourceText: "we're low on olive oil" },
  ]);

  const result = await dictateActions.parseGroceryDictation({
    workspaceId: WORKSPACE,
    transcript: "we're low on olive oil",
  });

  expect(result).toMatchObject({
    ok: true,
    items: [{ lowConfidence: true, sourceText: "we're low on olive oil" }],
  });
});

it("rejects a reply that fails schema validation without inserting anything", async () => {
  mockModelReply([{ name: "Milk", quantity: -1, category: "dairy", confidence: 0.9, sourceText: "milk" }]);
  generateObject.mockRejectedValue(new Error("response did not match schema"));

  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk" });

  expect(result.ok).toBe(false);
});

it("rejects an empty transcript without calling the model", async () => {
  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "   " });

  expect(result.ok).toBe(false);
  expect(generateObject).not.toHaveBeenCalled();
});

it("refuses a workspace the caller does not belong to", async () => {
  const result = await dictateActions.parseGroceryDictation({ workspaceId: OTHER, transcript: "milk" });

  expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Forbidden") });
  expect(generateObject).not.toHaveBeenCalled();
});
