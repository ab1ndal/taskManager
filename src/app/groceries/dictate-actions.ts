"use server";

import { APICallError, generateObject, RetryError } from "ai";
import { openai } from "@ai-sdk/openai";

import { assertHouseholdWorkspace, assertWorkspaceMember, requireUser } from "@/lib/auth";
import type { ActionResult } from "@/app/tasks/action-result";
import { run } from "@/app/tasks/action-run";
import { parseInput } from "@/app/tasks/schemas";
import { GROCERY_CATEGORIES, localToday } from "./categories";
import {
  dictateInputSchema,
  rawDictatedItemSchema,
  toReviewItem,
  type DictateInput,
  type ReviewGroceryItem,
} from "./dictate-schema";
import { mapOpenAiTimeout, openAiHttpError, OPENAI_TIMEOUT_MS, requireOpenAiKey } from "./openai-errors";

/**
 * Turns one dictated transcript into structured, reviewable grocery rows.
 *
 * Calls OpenAI directly via `@ai-sdk/openai` (OPENAI_API_KEY, the same key transcription uses) —
 * the Vercel AI Gateway's free-tier routing rejected the previous model with a 403
 * (`no_providers_available`), so this bypasses the gateway rather than working around a billing
 * restriction. `gpt-6-luna` is OpenAI's efficient tier and supports structured outputs; reasoning
 * effort is `low` because this is short-text extraction, and the review screen is the safety net
 * for a wrong guess, not this model call.
 *
 * Parsing never writes anything — the caller commits each accepted row through the existing
 * `addGroceryItem` action (actions.ts), so there is exactly one insert path for a grocery item
 * whether it was typed or dictated.
 */
export async function parseGroceryDictation(
  input: DictateInput,
): Promise<ActionResult<{ items: ReviewGroceryItem[] }>> {
  return run("parseGroceryDictation", async () => {
    const { user } = await requireUser();
    const { workspaceId, transcript } = parseInput(dictateInputSchema, input);
    await assertWorkspaceMember(workspaceId, user.id);
    await assertHouseholdWorkspace(workspaceId);
    // The provider reads the key itself; checked here so a missing one fails honestly, up front.
    requireOpenAiKey();

    const today = localToday();
    const timeout = AbortSignal.timeout(OPENAI_TIMEOUT_MS);
    const { object } = await generateObject({
      model: openai("gpt-6-luna"),
      providerOptions: { openai: { reasoningEffort: "low" } },
      schema: rawDictatedItemSchema,
      output: "array",
      schemaName: "GroceryDictationItems",
      schemaDescription: "Grocery items extracted from one dictated shopping list.",
      prompt: buildPrompt(transcript, today),
      // One retry absorbs a blip; the timeout bounds both attempts together, since the person is
      // watching a spinner.
      maxRetries: 1,
      abortSignal: timeout,
    }).catch((error: unknown) => {
      throw mapSdkError(error, timeout);
    });

    return { items: object.map((item) => toReviewItem(item, today)) };
  });
}

/**
 * The AI SDK's failures as the shared OpenAI failures. After `maxRetries` the SDK wraps the
 * attempts in a `RetryError`; the last attempt says why it finally failed.
 */
function mapSdkError(error: unknown, timeout: AbortSignal): unknown {
  const last = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(last) && last.statusCode !== undefined) {
    return openAiHttpError("parse", last.statusCode, last.responseBody, last);
  }
  // The SDK never retries an abort, so a timeout always arrives unwrapped.
  return mapOpenAiTimeout("parse", error, timeout);
}

/** "Sunday, 2026-09-27": the weekday is what lets the model resolve "expires Friday". */
function describeDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
  return `${weekday}, ${date}`;
}

function buildPrompt(transcript: string, today: string): string {
  return [
    "Split the following dictated grocery list into individual items. The speaker may name",
    "several items in one breath, use rough quantities ('a dozen', 'a couple', 'a few'), or just",
    "say they're running low on something with no quantity at all.",
    "",
    "For each item, return:",
    "- name: the plain product name, singular, no quantity or expiry words in it",
    "- quantity: a whole number if a count was said or clearly implied (e.g. 'a dozen eggs' -> 12,",
    "  'a couple lemons' -> 2), otherwise null — never guess a number nobody implied",
    `- category: your best guess, exactly one of these slugs (label in brackets): ${GROCERY_CATEGORIES.map((c) => `${c.slug} (${c.label})`).join(", ")}`,
    "- confidence: 0 to 1, how sure you are this is a real, distinct item with the right name,",
    "  quantity and category",
    "- sourceText: the exact fragment of the transcript this item came from",
    "- expiresOn: the expiry, use-by or best-before date as YYYY-MM-DD, only if the speaker said one",
    "  for this item (e.g. 'milk expiring Friday', 'yogurt good till the 5th', 'bread lasts three",
    "  more days'). Resolve relative dates from today; a bare weekday or day of the month means its",
    "  next occurrence. Otherwise null — never estimate one from the kind of product",
    "",
    `Today is ${describeDay(today)}.`,
    `Transcript: "${transcript}"`,
  ].join("\n");
}
