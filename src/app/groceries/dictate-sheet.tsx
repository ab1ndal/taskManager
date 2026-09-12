"use client";

import { useId, useState, useTransition } from "react";
import { Mic, TriangleAlert, Trash2 } from "lucide-react";

import { toast } from "@/components/toaster";
import { GENERIC_ERROR } from "@/app/tasks/action-result";
import { addGroceryItem } from "./actions";
import { parseGroceryDictation } from "./dictate-actions";
import { GROCERY_CATEGORIES, isCategorySlug } from "./categories";
import type { ReviewGroceryItem } from "./dictate-schema";

type ReviewRow = ReviewGroceryItem & { id: string; error?: string };

function toRows(items: ReviewGroceryItem[]): ReviewRow[] {
  return items.map((item) => ({ ...item, id: crypto.randomUUID() }));
}

const inputClass =
  "block w-full min-w-0 min-h-11 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-base";

/**
 * Dictation entry point for one grocery view (shopping list or pantry).
 *
 * Speech-to-text happens in the OS keyboard, not here (docs/ios.md — iOS Safari has no
 * `SpeechRecognition`): this component's job starts once the user has typed or dictated a
 * transcript into the textarea. Parsing never inserts anything by itself — every accepted row goes
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
  const headingId = useId();

  function reset() {
    setOpen(false);
    setTranscript("");
    setRows(null);
    setParseError(null);
  }

  function parse() {
    if (parsing || transcript.trim() === "") return;
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
              ...(target === "stock" ? { category: row.category, quantity: row.quantity } : {}),
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
        className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-secondary)]"
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
      className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-medium">
          Dictate items
        </h2>
        <button type="button" onClick={reset} className="min-h-11 px-2 text-sm text-[var(--color-text-secondary)]">
          Cancel
        </button>
      </div>

      {rows === null ? (
        <>
          <textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            aria-label="Dictated grocery list"
            placeholder="Tap the keyboard mic and say your list, e.g. “milk, dozen eggs, couple lemons, we're low on olive oil”"
            rows={4}
            className={`${inputClass} py-2 resize-y`}
          />
          {parseError && (
            <p role="alert" className="text-sm text-[var(--color-danger-text)]">
              {parseError}
            </p>
          )}
          <button
            type="button"
            onClick={parse}
            disabled={parsing || transcript.trim() === ""}
            className="min-h-11 px-4 rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm font-medium disabled:opacity-50"
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
                    ? "border-[var(--color-warning-text)] bg-[var(--color-warning-surface)]"
                    : "border-[var(--color-border)]"
                }`}
              >
                {row.lowConfidence && (
                  <p className="flex items-start gap-1.5 text-xs text-[var(--color-warning-text)]">
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
                    className="shrink-0 inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-[var(--color-text-secondary)]"
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
                {row.error && (
                  <p role="alert" className="text-xs text-[var(--color-danger-text)]">
                    {row.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRows(null)}
              disabled={committing}
              className="min-h-11 px-3 text-sm text-[var(--color-text-secondary)]"
            >
              Back
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={committing || rows.length === 0}
              className="min-h-11 px-4 rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm font-medium disabled:opacity-50"
            >
              {committing ? "Adding…" : `Add ${rows.length} item${rows.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
