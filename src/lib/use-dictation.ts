"use client";

import { useCallback, useRef, useState } from "react";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";

/**
 * Routes one recognition session between several fields.
 *
 * The browser exposes a single recognizer per page in practice — starting a second while the first
 * is live either throws or silently steals the microphone — so dictation on more than one field
 * cannot be one `useSpeechRecognition` per textarea. A field claims the session by id, and claiming
 * it ends whatever session was running.
 */
export interface DictationController {
  isSupported: boolean;
  /** The field currently holding the session, or null when nothing is being dictated. */
  activeField: string | null;
  /** The last error the recognizer reported, and the field that was dictating when it arrived. */
  error: string | null;
  errorField: string | null;
  /** Start dictating into `field`, or stop if it already holds the session. */
  toggle(field: string, value: string, onChange: (text: string) => void): void;
  stop(): void;
  /** Keeps the committed text in sync when the user types into the field that is dictating. */
  noteChange(field: string, value: string): void;
}

export function useDictation(): DictationController {
  // The field that last claimed the session. It outlives the session on purpose: a terminal error
  // arrives after listening has already stopped, and the message has to be shown under the field
  // that was dictating, not floating loose in the form.
  const [claimedField, setClaimedField] = useState<string | null>(null);
  // The text a new utterance appends to: everything committed before it, whether dictated or typed.
  const baseRef = useRef("");
  const applyRef = useRef<(text: string) => void>(() => {});

  // Destructured because `useSpeechRecognition` returns a fresh object every render while its
  // `start`/`stop` are stable — reading them off the object would make every callback below
  // change identity each render, and `stop` has to stay stable for callers to depend on it.
  const {
    isSupported,
    isListening,
    error,
    start: startSpeech,
    stop: stopSpeech,
  } = useSpeechRecognition((transcript, isFinal) => {
    // `transcript` is the FULL text of the current utterance so far, not a delta — so it replaces
    // (rather than appends to) whatever the previous event in this utterance rendered. Only a
    // final result gets folded into the committed base.
    const base = baseRef.current;
    const combined = base ? `${base} ${transcript}` : transcript;
    if (isFinal) baseRef.current = combined;
    applyRef.current(combined);
  });

  // Derived rather than stored: a terminal error (permission denied, no microphone) drops
  // `isListening` from inside the recognizer's own callback, and a field that is no longer
  // listening is no longer dictating. Storing it would need an effect to undo it.
  const activeField = isListening ? claimedField : null;

  const stop = useCallback(() => {
    stopSpeech();
  }, [stopSpeech]);

  const toggle = useCallback(
    (field: string, value: string, onChange: (text: string) => void) => {
      if (isListening && claimedField === field) {
        stop();
        return;
      }
      // Switching fields mid-session: end the running one first, so the two recognizers never
      // overlap and the old field stops receiving transcripts.
      if (isListening) stopSpeech();

      baseRef.current = value;
      applyRef.current = onChange;
      setClaimedField(field);
      startSpeech();
    },
    [claimedField, isListening, startSpeech, stopSpeech, stop]
  );

  const noteChange = useCallback(
    (field: string, value: string) => {
      if (claimedField !== field) return;
      baseRef.current = value;
    },
    [claimedField]
  );

  return {
    isSupported,
    activeField,
    error,
    errorField: error ? claimedField : null,
    toggle,
    stop,
    noteChange,
  };
}
