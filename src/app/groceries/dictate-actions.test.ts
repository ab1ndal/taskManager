/**
 * @jest-environment node
 */
import { createFakeSupabase } from "@/test/supabase-fake";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const WORK = "33333333-3333-4333-8333-333333333333";

let fake: ReturnType<typeof createFakeSupabase>;
const generateObject = jest.fn();

jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));
// `ai` ships ESM only, which this Jest setup cannot load, so its two error classes are stood in for
// here. The stand-ins take the real constructors' arguments and expose the same `isInstance`,
// `statusCode`, `responseBody` and `lastError` the classifier reads.
jest.mock("ai", () => {
  class APICallError extends Error {
    readonly statusCode?: number;
    readonly responseBody?: string;
    constructor({ message, statusCode, responseBody }: { message: string; statusCode?: number; responseBody?: string }) {
      super(message);
      this.name = "AI_APICallError";
      this.statusCode = statusCode;
      this.responseBody = responseBody;
    }
    static isInstance(error: unknown): error is APICallError {
      return error instanceof APICallError;
    }
  }
  class RetryError extends Error {
    readonly errors: unknown[];
    constructor({ message, errors }: { message: string; reason: string; errors: unknown[] }) {
      super(message);
      this.name = "AI_RetryError";
      this.errors = errors;
    }
    get lastError() {
      return this.errors[this.errors.length - 1];
    }
    static isInstance(error: unknown): error is RetryError {
      return error instanceof RetryError;
    }
  }
  return { generateObject: (...args: unknown[]) => generateObject(...args), APICallError, RetryError };
});
jest.mock("@ai-sdk/openai", () => ({ openai: (model: string) => model }));

import { APICallError, RetryError } from "ai";

import * as dictateActions from "./dictate-actions";
import { DICTATION_BUSY, DICTATION_TIMED_OUT, DICTATION_UNAVAILABLE, OPENAI_TIMEOUT_MS } from "./openai-errors";

const originalKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENAI_API_KEY = "test-key";
  fake = createFakeSupabase({
    tables: {
      workspaces: [
        { id: WORKSPACE, kind: "household" },
        { id: OTHER, kind: "household" },
        { id: WORK, kind: "work" },
      ],
      workspace_members: [
        { id: "member", workspace_id: WORKSPACE, auth_user_id: "auth-user-1" },
        { id: "work-member", workspace_id: WORK, auth_user_id: "auth-user-1" },
      ],
    },
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  process.env.OPENAI_API_KEY = originalKey;
});

function loggedLine(): Record<string, unknown> {
  const calls = (console.error as jest.Mock).mock.calls;
  expect(calls).toHaveLength(1);
  return JSON.parse(calls[0][0] as string);
}

function apiCallError(statusCode: number, body: unknown) {
  return new APICallError({
    message: "Incorrect API key provided: sk-abc***xyz",
    url: "https://api.openai.com/v1/responses",
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify(body),
  });
}

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
  // Pinned clock: an expiry before today is dropped, so a bare future date here would rot.
  jest.useFakeTimers({ now: new Date("2026-09-28T19:00:00Z") });
  mockModelReply([
    { name: "Milk", quantity: null, category: "dairy", confidence: 0.9, sourceText: "milk expiring friday", expiresOn: "2026-10-02" },
  ]);

  let result;
  try {
    result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk expiring friday" });
  } finally {
    jest.useRealTimers();
  }

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

it("drops a model expiry earlier than today so stock is never born expired", async () => {
  jest.useFakeTimers({ now: new Date("2026-09-28T19:00:00Z") });
  mockModelReply([
    { name: "Milk", quantity: null, category: "dairy", confidence: 0.9, sourceText: "milk", expiresOn: "2026-09-27" },
    { name: "Bread", quantity: null, category: "baked", confidence: 0.9, sourceText: "bread", expiresOn: "2026-09-28" },
  ]);

  let result;
  try {
    result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk, bread" });
  } finally {
    jest.useRealTimers();
  }

  expect(result).toMatchObject({ ok: true, items: [{ expiresOn: null }, { expiresOn: "2026-09-28" }] });
});

it("keeps the rest of the list when one model item's name or fragment is oversized", async () => {
  mockModelReply([
    { name: "x".repeat(150), quantity: null, category: "pantry", confidence: 0.4, sourceText: "y".repeat(300), expiresOn: null },
    { name: "Milk", quantity: null, category: "dairy", confidence: 0.9, sourceText: "milk", expiresOn: null },
  ]);

  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk" });

  expect(result).toMatchObject({
    ok: true,
    items: [{ name: "x".repeat(100), sourceText: "y".repeat(200) }, { name: "Milk" }],
  });
});

it("refuses a work workspace the caller belongs to without calling the model", async () => {
  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORK, transcript: "milk" });

  expect(result).toMatchObject({ ok: false, error: expect.stringContaining("not a household") });
  expect(generateObject).not.toHaveBeenCalled();
});

it("bounds the model call with a timeout and a single retry", async () => {
  const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
  mockModelReply([]);

  await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk" });

  expect(timeoutSpy).toHaveBeenCalledWith(OPENAI_TIMEOUT_MS);
  expect(generateObject).toHaveBeenCalledWith(
    expect.objectContaining({ maxRetries: 1, abortSignal: timeoutSpy.mock.results[0].value }),
  );
});

it("says dictation is unavailable when OpenAI rejects the key, logging openai_auth", async () => {
  generateObject.mockRejectedValue(
    apiCallError(401, { error: { type: "invalid_request_error", code: "invalid_api_key" } }),
  );

  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk" });

  expect(result).toEqual({ ok: false, error: DICTATION_UNAVAILABLE });
  const line = loggedLine();
  expect(line).toMatchObject({ action: "parseGroceryDictation", code: "openai_auth", status: 401 });
  expect(JSON.stringify(line)).not.toMatch(/sk-|Incorrect API key|milk/);
});

it("says dictation is busy when the retry also hits the rate limit", async () => {
  const limited = apiCallError(429, { error: { type: "requests", code: "rate_limit_exceeded" } });
  generateObject.mockRejectedValue(
    new RetryError({ message: "Failed after 2 attempts", reason: "maxRetriesExceeded", errors: [limited, limited] }),
  );

  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk" });

  expect(result).toEqual({ ok: false, error: DICTATION_BUSY });
  expect(loggedLine()).toMatchObject({ code: "openai_rate_limit", status: 429 });
});

it("says it took too long when the model call times out", async () => {
  generateObject.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk" });

  expect(result).toEqual({ ok: false, error: DICTATION_TIMED_OUT });
  expect(loggedLine()).toMatchObject({ code: "openai_timeout" });
});

it("says it took too long when the timeout fires during the SDK's retry backoff", async () => {
  // The SDK's backoff rejects with a plain AbortError, not TimeoutError, when the signal fires.
  jest.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(new DOMException("t", "TimeoutError")));
  generateObject.mockRejectedValue(new DOMException("This operation was aborted", "AbortError"));

  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk" });

  expect(result).toEqual({ ok: false, error: DICTATION_TIMED_OUT });
  expect(loggedLine()).toMatchObject({ code: "openai_timeout" });
});

it("says dictation is unavailable without calling the model when the key is not configured", async () => {
  delete process.env.OPENAI_API_KEY;

  const result = await dictateActions.parseGroceryDictation({ workspaceId: WORKSPACE, transcript: "milk" });

  expect(result).toEqual({ ok: false, error: DICTATION_UNAVAILABLE });
  expect(generateObject).not.toHaveBeenCalled();
  expect(loggedLine()).toMatchObject({ code: "openai_key_missing" });
});
