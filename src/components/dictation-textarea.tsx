"use client";

import { useEffect, useRef } from "react";
import { Mic, Square } from "lucide-react";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import type { DictationController } from "@/lib/use-dictation";

/**
 * A textarea that can be dictated into. The mic sits inside the field rather than beside it, so a
 * dictatable textarea drops into any layout — a full-width form field, a flex row, a two-column
 * subtask row — without each site inventing its own arrangement.
 *
 * Dictation replaces the whole value on every interim result, which never moves the caret, so the
 * browser never scrolls: past the visible rows the speaker watches a frozen first line while their
 * words land out of sight. The effect below keeps the newest text in view for as long as this field
 * holds the session.
 */
export function DictationTextarea({
  field,
  value,
  onChange,
  dictation,
  dictateLabel,
  className = "",
  wrapperClassName = "",
  ...textareaProps
}: {
  field: string;
  value: string;
  onChange: (value: string) => void;
  dictation: DictationController;
  /** Idle label for the mic button — "Dictate update", "Dictate task details", … */
  dictateLabel: string;
  className?: string;
  wrapperClassName?: string;
} & Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "className"
>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const isDictating = dictation.activeField === field;

  useEffect(() => {
    if (!isDictating) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [isDictating, value]);

  return (
    <div className={`relative ${wrapperClassName}`}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          dictation.noteChange(field, e.target.value);
          onChange(e.target.value);
        }}
        // `block` matters: a textarea is inline by default, which leaves a few pixels of descender
        // space under it inside the wrapper — enough that a mic positioned from the wrapper's
        // bottom edge sits below the field's own border instead of inside it. `pr-10` keeps the
        // text from running under the mic.
        className={`${className} block ${dictation.isSupported ? "pr-10" : ""}`}
        {...textareaProps}
      />
      {dictation.isSupported && (
        // Borderless and transparent, inset clear of the field's own border: a bordered box in the
        // corner reads as a second control bolted onto the field rather than part of it. Idle it is
        // a muted glyph; dictating, it is a filled stop in the danger tokens, which is the only
        // state that needs to be unmissable.
        <button
          type="button"
          aria-label={isDictating ? "Stop dictating" : dictateLabel}
          onClick={() => dictation.toggle(field, value, onChange)}
          disabled={textareaProps.disabled}
          className={`absolute right-1.5 bottom-1.5 w-8 h-8 flex items-center justify-center rounded-full text-sm disabled:opacity-50 transition-colors ${
            isDictating
              ? "bg-[var(--color-danger-surface)] text-[var(--color-danger-text)]"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent-text)]"
          }`}
        >
          {isDictating ? (
            <Square
              size={ICON_SECONDARY}
              strokeWidth={ICON_STROKE}
              fill="currentColor"
              aria-hidden="true"
            />
          ) : (
            <Mic size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
          )}
        </button>
      )}
      {dictation.errorField === field && dictation.error && (
        <p role="alert" className="mt-1 text-2xs text-[var(--color-danger-text)]">
          {dictation.error}
        </p>
      )}
    </div>
  );
}
