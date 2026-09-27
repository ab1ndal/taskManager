"use server";

import { assertWorkspaceMember, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/tasks/action-result";
import { assertNoError, run } from "@/app/tasks/action-run";
import { parseInput } from "@/app/tasks/schemas";
import { AUDIO_EXTENSIONS, baseMediaType, isAudioMediaType, transcribeInputSchema } from "./transcribe-schema";

const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

/**
 * `gpt-transcribe` over `gpt-4o-mini-transcribe`: it is OpenAI's recommended model for recorded
 * speech, and it is the one that takes `keywords` — literal terms expected in the audio — which is
 * what fixes misheard item names. At $0.0045/min against $0.003/min the difference on a list of a
 * few seconds is negligible.
 */
const TRANSCRIPTION_MODEL = "gpt-transcribe";

/** The workspace's most-added items are the likeliest words in a list; the rest add little. */
const MAX_KEYWORDS = 100;

const CONTEXT_PROMPT =
  "A person reading out a grocery shopping list or pantry stock. Item names may include " +
  "ingredients from non-English cuisines particularly indian cuisine. Some words may be in Hindi."+
  "Specific Quantities like 'a dozen' are common.";

/**
 * Transcribes one recorded dictation for the grocery sheet.
 *
 * Calls OpenAI's REST endpoint directly rather than through `@ai-sdk/openai`: the SDK's
 * transcription options do not include `keywords` or `languages`, and it would default this model
 * to `verbose_json`. One multipart POST does not justify a dependency that cannot send the field
 * this feature exists for.
 *
 * The audio exists only in this request — it is never written to storage or logged, per the
 * product rule that audio must never be stored. The caller puts the returned text in the editable
 * textarea; nothing is parsed or inserted from here.
 */
export async function transcribeGroceryAudio(formData: FormData): Promise<ActionResult<{ text: string }>> {
  return run("transcribeGroceryAudio", async () => {
    const { user } = await requireUser();
    const { workspaceId, audio } = parseInput(transcribeInputSchema, {
      workspaceId: formData.get("workspaceId"),
      audio: formData.get("audio"),
    });
    await assertWorkspaceMember(workspaceId, user.id);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const mediaType = baseMediaType(audio.type);
    // Checked by the schema already; narrowed again here so the extension lookup is typed.
    if (!isAudioMediaType(mediaType)) throw new Error(`unsupported media type ${mediaType}`);

    const body = new FormData();
    body.append("model", TRANSCRIPTION_MODEL);
    // OpenAI detects the container from the filename, not the part's content type.
    body.append("file", audio, `dictation.${AUDIO_EXTENSIONS[mediaType]}`);
    body.append("response_format", "json");
    body.append("prompt", CONTEXT_PROMPT);
    body.append("languages[]", "en");
    for (const keyword of await loadKeywords(workspaceId)) body.append("keywords[]", keyword);

    const response = await fetch(TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
    });
    if (!response.ok) {
      // The error body is OpenAI's JSON error (type, message), never the audio.
      throw new Error(`OpenAI transcription failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
    }

    const { text } = (await response.json()) as { text?: unknown };
    if (typeof text !== "string") throw new Error("OpenAI transcription response had no text");

    return { text: text.trim() };
  });
}

async function loadKeywords(workspaceId: string): Promise<string[]> {
  const { data, error } = await createAdminClient()
    .from("grocery_items")
    .select("name")
    .eq("workspace_id", workspaceId)
    .order("times_added", { ascending: false })
    .limit(MAX_KEYWORDS);
  assertNoError("load grocery keywords", { error });

  return (data ?? []).map((row) => String(row.name).trim()).filter((name) => name !== "");
}
