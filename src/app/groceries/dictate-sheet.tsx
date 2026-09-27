"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { LoaderCircle, Mic, Square, TriangleAlert, Trash2 } from "lucide-react";

import { toast } from "@/components/toaster";
import { GENERIC_ERROR } from "@/app/tasks/action-result";
import { addGroceryItem } from "./actions";
import { parseGroceryDictation } from "./dictate-actions";
import { GROCERY_CATEGORIES, isCategorySlug } from "./categories";
import type { ReviewGroceryItem } from "./dictate-schema";
import { transcribeGroceryAudio } from "./transcribe-actions";
import { MAX_RECORDING_MS, RECORDING_BITS_PER_SECOND } from "./transcribe-schema";
import { useAudioRecorder, type RecorderStatus } from "@/lib/use-audio-recorder";

type ReviewRow = ReviewGroceryItem & { id: string; error?: string };

function toRows(items: ReviewGroceryItem[]): ReviewRow[] {
  return items.map((item) => ({ ...item, id: crypto.randomUUID() }));
}

const inputClass =
  "block w-full min-w-0 min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-base";

/**
 * Dictation entry point for one grocery view (shopping list or pantry).
 *
 * Speech-to-text is a recorded clip sent to OpenAI (`transcribeGroceryAudio`), not the browser's
 * `SpeechRecognition`, which does not work in the installed iPhone app (docs/ios.md). The returned
 * text is appended to the editable textarea — typing and the OS keyboard's own dictation still
 * work there too — and nothing is parsed until the user taps Parse. Parsing never inserts anything
 * by itself — every accepted row goes
 * through `addGroceryItem`, the same action the plain add row uses, so there is one insert path
 * whether an item was typed one at a time or dictated as a list.
 */
export function DictateSheet({ workspaceId, target }: { workspaceId: string; target: "stock" | "list" }) {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, startParsing] = useTransition();
  const [committing, startCommitting] = useTransition();
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  // Bumped whenever the sheet resets, so a transcription that returns after Cancel is dropped
  // rather than written into a sheet the user already closed.
  const sessionRef = useRef(0);
  const headingId = useId();

  const onRecorded = useCallback(
    async (audio: Blob) => {
      const session = sessionRef.current;
      setTranscribing(true);
      setTranscribeError(null);
      const formData = new FormData();
      formData.append("workspaceId", workspaceId);
      formData.append("audio", audio);
      try {
        const result = await transcribeGroceryAudio(formData);
        if (session !== sessionRef.current) return;
        if (!result.ok) {
          setTranscribeError(result.error);
        } else if (result.text === "") {
          setTranscribeError("Didn't catch anything — try again a little closer to the mic.");
        } else {
          setTranscript((current) => (current.trim() === "" ? result.text : `${current.trimEnd()} ${result.text}`));
        }
      } catch (error) {
        console.error("grocery transcription call rejected", error);
        if (session === sessionRef.current) setTranscribeError(GENERIC_ERROR);
      } finally {
        if (session === sessionRef.current) setTranscribing(false);
      }
    },
    [workspaceId],
  );

  const recorder = useAudioRecorder({
    onRecorded,
    maxDurationMs: MAX_RECORDING_MS,
    audioBitsPerSecond: RECORDING_BITS_PER_SECOND,
  });
  const recording = recorder.status !== "idle";
  const busy = recording || transcribing;

  function reset() {
    sessionRef.current += 1;
    recorder.cancel();
    setTranscribing(false);
    setTranscribeError(null);
    setOpen(false);
    setTranscript("");
    setRows(null);
    setParseError(null);
  }

  function parse() {
    if (parsing || busy || transcript.trim() === "") return;
    setParseError(null);
    startParsing(async () => {
      try {
        const result = await parseGroceryDictation({ workspaceId, transcript });
        if (!result.ok) {
          setParseError(result.error);
          return;
        }
        if (result.items.length === 0) {
          setParseError("Couldn't make out any items in that — try rephrasing.");
          return;
        }
        setRows(toRows(result.items));
      } catch (error) {
        console.error("grocery dictation parse call rejected", error);
        setParseError(GENERIC_ERROR);
      }
    });
  }

  function updateRow(id: string, patch: Partial<ReviewRow>) {
    setRows((current) => current?.map((row) => (row.id === id ? { ...row, ...patch } : row)) ?? null);
  }

  function removeRow(id: string) {
    setRows((current) => {
      const next = current?.filter((row) => row.id !== id) ?? null;
      return next && next.length > 0 ? next : null;
    });
  }

  function commit() {
    if (committing || !rows || rows.length === 0) return;
    startCommitting(async () => {
      const outcomes = await Promise.all(
        rows.map(async (row) => {
          try {
            const result = await addGroceryItem({
              workspaceId,
              name: row.name,
              // A blank expiry is omitted, not sent as null: omitted means "estimate from the
              // category", which is what every dictated row got before expiry could be spoken.
              ...(target === "stock"
                ? { category: row.category, quantity: row.quantity, ...(row.expiresOn ? { expiresOn: row.expiresOn } : {}) }
                : {}),
              target,
            });
            return { row, ok: result.ok, error: result.ok ? undefined : result.error };
          } catch (error) {
            console.error("grocery dictation commit call rejected", error);
            return { row, ok: false, error: GENERIC_ERROR };
          }
        }),
      );

      const failed = outcomes.filter((outcome) => !outcome.ok);
      if (failed.length === 0) {
        toast(`Added ${outcomes.length} item${outcomes.length === 1 ? "" : "s"}`);
        reset();
        return;
      }

      setRows(failed.map(({ row, error }) => ({ ...row, error })));
      toast(
        failed.length === outcomes.length
          ? GENERIC_ERROR
          : `Added ${outcomes.length - failed.length}, ${failed.length} need another look`,
        "error",
      );
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full border border-(--color-border) bg-(--color-surface) text-sm text-(--color-text-secondary)"
      >
        <Mic size={16} aria-hidden />
        Dictate items
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="basis-full space-y-3 rounded-lg border border-(--color-border) bg-(--color-surface) p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-medium">
          Dictate items
        </h2>
        <button type="button" onClick={reset} className="min-h-11 px-2 text-sm text-(--color-text-secondary)">
          Cancel
        </button>
      </div>

      {rows === null ? (
        <>
          <textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            aria-label="Dictated grocery list"
            placeholder={
              recorder.isSupported
                ? "Tap Record and say your list, e.g. “milk, dozen eggs, couple lemons, we're low on olive oil”"
                : "Tap the keyboard mic and say your list, e.g. “milk, dozen eggs, couple lemons, we're low on olive oil”"
            }
            rows={4}
            className={`${inputClass} py-2 resize-y`}
          />
          {recorder.isSupported && (
            <RecordControl
              status={recorder.status}
              transcribing={transcribing}
              onStart={() => {
                setTranscribeError(null);
                void recorder.start();
              }}
              onStop={recorder.stop}
            />
          )}
          {(recorder.error ?? transcribeError) && (
            <p role="alert" className="text-sm text-(--color-danger-text)">
              {recorder.error ?? transcribeError}
            </p>
          )}
          {parseError && (
            <p role="alert" className="text-sm text-(--color-danger-text)">
              {parseError}
            </p>
          )}
          <button
            type="button"
            onClick={parse}
            disabled={parsing || busy || transcript.trim() === ""}
            className="min-h-11 px-4 rounded-full bg-(--color-accent) text-(--color-text-on-accent) text-sm font-medium disabled:opacity-50"
          >
            {parsing ? "Parsing…" : "Parse"}
          </button>
        </>
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className={`space-y-2 rounded-lg border p-2 ${
                  row.lowConfidence
                    ? "border-(--color-warning-text) bg-(--color-warning-surface)"
                    : "border-(--color-border)"
                }`}
              >
                {row.lowConfidence && (
                  <p className="flex items-start gap-1.5 text-xs text-(--color-warning-text)">
                    <TriangleAlert size={14} aria-hidden className="shrink-0 mt-0.5" />
                    <span>Not sure about this one — heard “{row.sourceText}”</span>
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <input
                    value={row.name}
                    onChange={(event) => updateRow(row.id, { name: event.target.value })}
                    aria-label="Item name"
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    aria-label={`Remove ${row.name}`}
                    className="shrink-0 inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-(--color-text-secondary)"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </div>
                {target === "stock" && (
                  <div className="flex items-center gap-2">
                    <input
                      value={row.quantity ?? ""}
                      onChange={(event) =>
                        updateRow(row.id, {
                          quantity: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={999}
                      step={1}
                      aria-label="Quantity"
                      placeholder="Qty"
                      className={`${inputClass} w-24`}
                    />
                    <select
                      value={row.category}
                      onChange={(event) => {
                        if (isCategorySlug(event.target.value)) updateRow(row.id, { category: event.target.value });
                      }}
                      aria-label="Category"
                      className={`${inputClass} h-11`}
                    >
                      {GROCERY_CATEGORIES.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {target === "stock" && (
                  <label className="flex items-center gap-2 text-sm text-(--color-text-secondary)">
                    <span className="shrink-0">Expires</span>
                    <input
                      value={row.expiresOn ?? ""}
                      onChange={(event) => updateRow(row.id, { expiresOn: event.target.value || null })}
                      type="date"
                      min="2020-01-01"
                      max="2100-01-01"
                      className={`${inputClass} h-11 text-(--color-text-primary)`}
                    />
                  </label>
                )}
                {row.error && (
                  <p role="alert" className="text-xs text-(--color-danger-text)">
                    {row.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {target === "stock" && (
            <p className="text-xs text-(--color-text-secondary)">
              Leave expiry blank to use the category’s usual shelf life.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRows(null)}
              disabled={committing}
              className="min-h-11 px-3 text-sm text-(--color-text-secondary)"
            >
              Back
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={committing || rows.length === 0}
              className="min-h-11 px-4 rounded-full bg-(--color-accent) text-(--color-text-on-accent) text-sm font-medium disabled:opacity-50"
            >
              {committing ? "Adding…" : `Add ${rows.length} item${rows.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Record / Stop / Transcribing button with an elapsed-time readout. Text labels, not icon-only, so
 * the state is never conveyed by colour or a pulsing dot alone; motion is `motion-safe` only.
 */
function RecordControl({
  status,
  transcribing,
  onStart,
  onStop,
}: {
  status: RecorderStatus;
  transcribing: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (status !== "recording") return;
    const startedAt = Date.now();
    const interval = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => {
      clearInterval(interval);
      setElapsedMs(0);
    };
  }, [status]);

  const announcement =
    status === "starting"
      ? "Waiting for microphone"
      : status === "recording"
        ? "Recording"
        : transcribing
          ? "Transcribing"
          : "";

  return (
    <div className="flex items-center gap-3">
      {status === "idle" ? (
        <button
          type="button"
          onClick={onStart}
          disabled={transcribing}
          className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full border border-(--color-border) bg-(--color-surface) text-sm font-medium disabled:opacity-50"
        >
          {transcribing ? (
            <LoaderCircle size={16} aria-hidden className="motion-safe:animate-spin" />
          ) : (
            <Mic size={16} aria-hidden />
          )}
          {transcribing ? "Transcribing…" : "Record"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onStop}
          className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full border border-(--color-danger-text) text-(--color-danger-text) bg-(--color-surface) text-sm font-medium"
        >
          <Square size={14} aria-hidden fill="currentColor" />
          Stop
        </button>
      )}
      {status === "recording" && (
        <span className="inline-flex items-center gap-1.5 text-sm text-(--color-text-secondary) tabular-nums">
          <span aria-hidden className="size-2 rounded-full bg-(--color-danger-text) motion-safe:animate-pulse" />
          Recording {formatElapsed(elapsedMs)} / {formatElapsed(MAX_RECORDING_MS)}
        </span>
      )}
      {status === "starting" && (
        <span className="text-sm text-(--color-text-secondary)">Waiting for microphone…</span>
      )}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
