import { z } from "zod";

/**
 * Upload contract for the grocery dictation mic (docs/product.md § Updates and Speech to Text).
 *
 * Shared by the recorder and the server action so the two cannot drift: the recorder stops itself
 * at `MAX_RECORDING_MS`, and at `RECORDING_BITS_PER_SECOND` that length stays well under
 * `MAX_AUDIO_BYTES`, which in turn stays under the `serverActions.bodySizeLimit` in next.config.ts.
 */

export const MAX_RECORDING_MS = 2 * 60 * 1000;

/** Speech needs nowhere near music bitrates; 64 kbps keeps a two-minute list around 1 MB. */
export const RECORDING_BITS_PER_SECOND = 64_000;

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

/**
 * Container types OpenAI's transcription endpoint accepts, mapped to the file extension it detects
 * the format from. `audio/mp4` is what Safari's MediaRecorder produces (including the installed
 * iPhone app); `audio/webm` is Chrome's. Ogg — Firefox's default — is not accepted by OpenAI, so
 * the recorder asks for webm instead.
 */
export const AUDIO_EXTENSIONS = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
} as const;

export type AudioMediaType = keyof typeof AUDIO_EXTENSIONS;

/** Strips codec parameters: MediaRecorder reports e.g. `audio/webm;codecs=opus`. */
export function baseMediaType(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

export function isAudioMediaType(type: string): type is AudioMediaType {
  return Object.hasOwn(AUDIO_EXTENSIONS, type);
}

export const transcribeInputSchema = z.object({
  workspaceId: z.uuid("Expected a UUID"),
  audio: z
    .instanceof(Blob, { message: "Expected an audio recording" })
    .refine((audio) => audio.size > 0, "That recording was empty — try again")
    .refine((audio) => audio.size <= MAX_AUDIO_BYTES, "That recording is too long — try a shorter list")
    .refine((audio) => isAudioMediaType(baseMediaType(audio.type)), "Unsupported recording format"),
});
