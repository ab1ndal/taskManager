import { createFakeSupabase } from "@/test/supabase-fake";

let fake = createFakeSupabase();
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake }));

import { categoryForUnknownName } from "./category-decision";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
}) as Response;

beforeEach(() => {
  fake = createFakeSupabase({ tables: { grocery_category_suggestions: [] } });
  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = jest.fn();
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  jest.restoreAllMocks();
});

it("keeps a local keyword match off the network", async () => {
  await expect(categoryForUnknownName(WORKSPACE, "Palak")).resolves.toBe("produce");
  expect(fetch).not.toHaveBeenCalled();
});

it("reuses a saved answer for the normalized name", async () => {
  fake.tables.grocery_category_suggestions = [{
    workspace_id: WORKSPACE,
    normalized_name: "c3s cleaner",
    category: "household",
  }];
  await expect(categoryForUnknownName(WORKSPACE, " C3S CLEANER ")).resolves.toBe("household");
  expect(fetch).not.toHaveBeenCalled();
});

it("asks Decisions with the 13 allowed choices and saves the answer", async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response({
    answers: [{ type: "choice", name: "category", choice: "household", confidence: 0.98 }],
  }));

  await expect(categoryForUnknownName(WORKSPACE, "Zibble")).resolves.toBe("household");
  const request = jest.mocked(fetch).mock.calls[0];
  const body = JSON.parse(String((request[1] as RequestInit).body));
  expect(body).toMatchObject({ model: "gpt-6-luna", input: "Zibble" });
  expect(body.questions[0].type).toBe("choice");
  expect(body.questions[0].choices).toHaveLength(13);
  expect(fake.tables.grocery_category_suggestions).toContainEqual(expect.objectContaining({
    workspace_id: WORKSPACE,
    normalized_name: "zibble",
    category: "household",
  }));
});

it("rejects an answer outside the category catalog", async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response({
    answers: [{ type: "choice", name: "category", choice: "meat" }],
  }));
  await expect(categoryForUnknownName(WORKSPACE, "Zibble")).rejects
    .toThrow("no valid category");
});
