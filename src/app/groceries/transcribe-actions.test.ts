/**
 * @jest-environment node
 */
import { createFakeSupabase } from "@/test/supabase-fake";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

let fake: ReturnType<typeof createFakeSupabase>;
const fetchMock = jest.fn();

jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));

import { transcribeGroceryAudio } from "./transcribe-actions";
import { COMMON_KEYWORDS, MAX_AUDIO_BYTES, MAX_KEYWORDS } from "./transcribe-schema";

const originalKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock;
  process.env.OPENAI_API_KEY = "test-key";
  fake = createFakeSupabase({
    tables: {
      workspace_members: [{ id: "member", workspace_id: WORKSPACE, auth_user_id: "auth-user-1" }],
      grocery_items: [
        { id: "g1", workspace_id: WORKSPACE, name: "Paneer", times_added: 9 },
        { id: "g2", workspace_id: WORKSPACE, name: "Atta", times_added: 4 },
        { id: "g3", workspace_id: OTHER, name: "Someone else's item", times_added: 50 },
      ],
    },
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  process.env.OPENAI_API_KEY = originalKey;
});

function upload({
  workspaceId = WORKSPACE,
  audio = new Blob(["fake audio"], { type: "audio/mp4" }) as Blob | null,
}: { workspaceId?: string; audio?: Blob | null } = {}) {
  const formData = new FormData();
  formData.append("workspaceId", workspaceId);
  if (audio) formData.append("audio", audio);
  return formData;
}

function mockOpenAiReply(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

function sentBody(): FormData {
  return fetchMock.mock.calls[0][1].body as FormData;
}

it("returns the trimmed transcript", async () => {
  mockOpenAiReply({ text: "  paneer, two litres of milk \n" });

  const result = await transcribeGroceryAudio(upload());

  expect(result).toEqual({ ok: true, text: "paneer, two litres of milk" });
});

it("sends gpt-transcribe with English and this workspace's item names as keywords", async () => {
  mockOpenAiReply({ text: "atta" });

  await transcribeGroceryAudio(upload());

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
  expect(init.headers).toEqual({ Authorization: "Bearer test-key" });
  const body = sentBody();
  expect(body.get("model")).toBe("gpt-transcribe");
  expect(body.get("response_format")).toBe("json");
  expect(body.getAll("languages[]")).toEqual(["en"]);
  expect(body.getAll("keywords[]").slice(0, 2)).toEqual(["Paneer", "Atta"]);
  expect(body.get("language")).toBeNull();
});

it("names the upload with the extension OpenAI detects the format from", async () => {
  mockOpenAiReply({ text: "milk" });

  await transcribeGroceryAudio(upload({ audio: new Blob(["x"], { type: "audio/webm;codecs=opus" }) }));

  expect((sentBody().get("file") as File).name).toBe("dictation.webm");
});

it("bounds the keyword query to the most-added items", async () => {
  mockOpenAiReply({ text: "milk" });

  await transcribeGroceryAudio(upload());

  const query = fake.queryLog.find((entry) => entry.table === "grocery_items");
  expect(query?.orderBy).toEqual([{ column: "times_added", ascending: false }]);
  expect(query?.limit).toBe(MAX_KEYWORDS - COMMON_KEYWORDS.length);
});

it("adds common Hindi grocery words after the workspace's own names", async () => {
  mockOpenAiReply({ text: "daal and naan" });

  await transcribeGroceryAudio(upload());

  const keywords = sentBody().getAll("keywords[]");
  expect(keywords).toEqual(expect.arrayContaining(["daal", "naan"]));
  expect(keywords.indexOf("daal")).toBeGreaterThan(keywords.indexOf("Atta"));
});

it("does not repeat a common word the workspace already has, keeping the workspace's spelling", async () => {
  mockOpenAiReply({ text: "paneer" });

  await transcribeGroceryAudio(upload());

  const keywords = sentBody().getAll("keywords[]").map((k) => String(k).toLowerCase());
  expect(keywords.filter((k) => k === "paneer")).toHaveLength(1);
  expect(sentBody().getAll("keywords[]")).toContain("Paneer");
});

it("never sends more than the keyword cap", async () => {
  mockOpenAiReply({ text: "milk" });
  fake.tables.grocery_items = Array.from({ length: 150 }, (_, i) => ({
    id: `x${i}`, workspace_id: WORKSPACE, name: `Item ${i}`, times_added: 150 - i,
  }));

  await transcribeGroceryAudio(upload());

  expect(sentBody().getAll("keywords[]").length).toBeLessThanOrEqual(MAX_KEYWORDS);
});

it("rejects a non-member without calling OpenAI", async () => {
  const result = await transcribeGroceryAudio(upload({ workspaceId: OTHER }));

  expect(result.ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects a recording over the size cap without calling OpenAI", async () => {
  const tooBig = new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: "audio/mp4" });

  const result = await transcribeGroceryAudio(upload({ audio: tooBig }));

  expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/too long/) });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects a format OpenAI cannot read without calling it", async () => {
  const result = await transcribeGroceryAudio(upload({ audio: new Blob(["x"], { type: "audio/ogg" }) }));

  expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/unsupported recording format/i) });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects a missing or empty recording", async () => {
  expect((await transcribeGroceryAudio(upload({ audio: null }))).ok).toBe(false);
  expect((await transcribeGroceryAudio(upload({ audio: new Blob([], { type: "audio/mp4" }) }))).ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("returns the generic error when OpenAI fails, logging the status but not the audio", async () => {
  mockOpenAiReply({ error: { message: "Incorrect API key provided" } }, 401);

  const result = await transcribeGroceryAudio(upload());

  expect(result).toEqual({ ok: false, error: expect.not.stringMatching(/401|API key/) });
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("401"));
});

it("fails without calling OpenAI when the key is not configured", async () => {
  delete process.env.OPENAI_API_KEY;

  const result = await transcribeGroceryAudio(upload());

  expect(result.ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("OPENAI_API_KEY"));
});
