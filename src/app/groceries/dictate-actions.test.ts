import { createFakeSupabase } from "@/test/supabase-fake";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

let fake: ReturnType<typeof createFakeSupabase>;
const generateObject = jest.fn();

jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));
jest.mock("ai", () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }));
jest.mock("@ai-sdk/openai", () => ({ openai: (model: string) => model }));

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
    { name: "Milk", quantity: null, category: "dairy", confidence: 0.95, sourceText: "milk", expiresOn: null },
    { name: "Eggs", quantity: 12, category: "dairy", confidence: 0.8, sourceText: "dozen eggs", expiresOn: null },
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
  mockModelReply([{ name: "Chicken", quantity: null, category: "meat", confidence: 0.9, sourceText: "chicken", expiresOn: null }]);

  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "chicken" });

  expect(result).toMatchObject({ ok: true, items: [{ category: "pantry" }] });
});

it("flags a low-confidence row instead of dropping it", async () => {
  mockModelReply([
    { name: "olive oil", quantity: null, category: "pantry", confidence: 0.3, sourceText: "we're low on olive oil", expiresOn: null },
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
  mockModelReply([{ name: "Milk", quantity: -1, category: "dairy", confidence: 0.9, sourceText: "milk", expiresOn: null }]);
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

it("parses with gpt-6-luna at low reasoning effort", async () => {
  mockModelReply([{ name: "Milk", quantity: null, category: "dairy", confidence: 0.9, sourceText: "milk", expiresOn: null }]);

  await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk" });

  expect(generateObject).toHaveBeenCalledWith(
    expect.objectContaining({ model: "gpt-6-luna", providerOptions: { openai: { reasoningEffort: "low" } } }),
  );
});

it("passes a spoken expiry through to the review row", async () => {
  mockModelReply([
    { name: "Milk", quantity: null, category: "dairy", confidence: 0.9, sourceText: "milk expiring friday", expiresOn: "2026-10-02" },
  ]);

  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk expiring friday" });

  expect(result).toMatchObject({ ok: true, items: [{ name: "Milk", expiresOn: "2026-10-02" }] });
});

it("gives the model today's date and weekday in the app timezone so relative expiries resolve", async () => {
  // 2026-09-28 03:00 UTC is still Sunday 2026-09-27 in the app's Pacific timezone.
  jest.useFakeTimers({ now: new Date("2026-09-28T03:00:00Z") });
  mockModelReply([]);

  try {
    await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk expiring friday" });
  } finally {
    jest.useRealTimers();
  }

  const { prompt } = generateObject.mock.calls[0][0] as { prompt: string };
  expect(prompt).toContain("Today is Sunday, 2026-09-27");
});
