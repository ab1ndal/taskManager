/**
 * @jest-environment node
 */
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import { GENERIC_ERROR } from "./action-result";
import { assertNoError, ExternalServiceError, run } from "./action-run";

function loggedLine(): Record<string, unknown> {
  const calls = (console.error as jest.Mock).mock.calls;
  expect(calls).toHaveLength(1);
  return JSON.parse(calls[0][0] as string);
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

it("keeps the existing log fields and adds the error name and a short request id", async () => {
  const result = await run("someAction", async () => {
    throw new TypeError("boom");
  });

  expect(result).toEqual({ ok: false, error: GENERIC_ERROR });
  const line = loggedLine();
  expect(line).toMatchObject({ level: "error", action: "someAction", message: "boom", errorName: "TypeError" });
  expect(line.requestId).toMatch(/^[0-9a-f]{8}$/);
});

it("gives each failure its own request id", async () => {
  const fail = () => run("someAction", async () => { throw new Error("x"); });
  await fail();
  await fail();

  const [first, second] = (console.error as jest.Mock).mock.calls.map((c) => JSON.parse(c[0]).requestId);
  expect(first).not.toBe(second);
});

it("logs the Postgres code a Supabase error carried through assertNoError", async () => {
  await run("someAction", async () => {
    assertNoError("insert thing", { error: { message: "duplicate key", code: "23505" } as { message: string } });
    return {};
  });

  expect(loggedLine()).toMatchObject({ message: "insert thing: duplicate key", pgCode: "23505" });
});

it("shows an external service failure's own message and logs its code and HTTP status", async () => {
  const result = await run("someAction", async () => {
    throw new ExternalServiceError({
      code: "openai_rate_limit",
      userMessage: "Busy — try again.",
      detail: "OpenAI transcription failed: 429",
      status: 429,
    });
  });

  expect(result).toEqual({ ok: false, error: "Busy — try again." });
  expect(loggedLine()).toMatchObject({
    level: "error",
    action: "someAction",
    message: "OpenAI transcription failed: 429",
    errorName: "ExternalServiceError",
    code: "openai_rate_limit",
    status: 429,
  });
});

it("still logs a thrown non-Error value", async () => {
  const result = await run("someAction", async () => {
    throw "plain string";
  });

  expect(result).toEqual({ ok: false, error: GENERIC_ERROR });
  expect(loggedLine()).toMatchObject({ level: "error", action: "someAction", message: "plain string" });
});
