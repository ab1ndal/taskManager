"use server";

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

import { assertWorkspaceMember, requireUser } from "@/lib/auth";
import type { ActionResult } from "@/app/tasks/action-result";
import { run } from "@/app/tasks/action-run";
import { parseInput } from "@/app/tasks/schemas";
import { CATEGORY_SLUGS } from "./categories";
import {
  dictateInputSchema,
  rawDictatedItemSchema,
  toReviewItem,
  type DictateInput,
  type ReviewGroceryItem,
} from "./dictate-schema";

/**
 * Turns one dictated transcript into structured, reviewable grocery rows.
 *
 * Calls Anthropic directly via `@ai-sdk/anthropic` (ANTHROPIC_API_KEY) — the Vercel AI Gateway's
 * free-tier routing rejected this model with a 403 (`no_providers_available`), so this bypasses
 * the gateway rather than working around a billing restriction. Haiku is picked over Sonnet/Opus:
 * this is short-text structured extraction, not reasoning, and the review screen is the safety net
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

    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      schema: rawDictatedItemSchema,
      output: "array",
      schemaName: "GroceryDictationItems",
      schemaDescription: "Grocery items extracted from one dictated shopping list.",
      prompt: buildPrompt(transcript),
    });

    return { items: object.map(toReviewItem) };
  });
}

function buildPrompt(transcript: string): string {
  return [
    "Split the following dictated grocery list into individual items. The speaker may name",
    "several items in one breath, use rough quantities ('a dozen', 'a couple', 'a few'), or just",
    "say they're running low on something with no quantity at all.",
    "",
    "For each item, return:",
    "- name: the plain product name, singular, no quantity words in it",
    "- quantity: a whole number if a count was said or clearly implied (e.g. 'a dozen eggs' -> 12,",
    "  'a couple lemons' -> 2), otherwise null — never guess a number nobody implied",
    `- category: your best guess, one of: ${CATEGORY_SLUGS.join(", ")}`,
    "- confidence: 0 to 1, how sure you are this is a real, distinct item with the right name,",
    "  quantity and category",
    "- sourceText: the exact fragment of the transcript this item came from",
    "",
    `Transcript: "${transcript}"`,
  ].join("\n");
}
