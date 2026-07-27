"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function getConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/** Whether the constructor exists never changes after load, so there is nothing to subscribe to. */
function subscribeToNothing() {
  return () => {};
}

function getIsSupported() {
  return getConstructor() !== null;
}

/**
 * Wraps the browser's SpeechRecognition API. Chrome ends a session on silence even with
 * `continuous: true`, so `onend` auto-restarts unless `stop()` was called explicitly — tracked via
 * `stoppedByUserRef` rather than `isListening` state, since state updates inside the `onend`
 * callback would be stale by the time the callback reads them.
 */
export function useSpeechRecognition(onResult: (transcript: string, isFinal: boolean) => void) {
  // Support is a browser-only fact, so it is read through useSyncExternalStore with a `false`
  // server snapshot: the server and the first client render agree (no mic button), then the client
  // re-renders with the real value. Reading it during render instead would mismatch hydration.
  const isSupported = useSyncExternalStore(subscribeToNothing, getIsSupported, () => false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stoppedByUserRef = useRef(true);
  const onResultRef = useRef(onResult);

  // Kept in an effect rather than assigned during render: writing a ref while rendering is unsafe
  // (and lint-flagged). Recognition events can only arrive after the effect has run, so the
  // callback the handler reads is always the latest one.
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const start = useCallback(() => {
    const Ctor = getConstructor();
    if (!Ctor) return;

    // Guard against concurrent start() calls: if a recognition session is already active, bail out.
    if (recognitionRef.current) return;

    setError(null);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      onResultRef.current(result[0].transcript, result.isFinal);
    };

    recognition.onerror = (event) => {
      // Terminal errors: no retry can succeed (permission denied, or no mic to capture from), so
      // mark this as a user-stopped session up front — otherwise onend's restart branch fires
      // immediately after, fails the same way, and loops forever.
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed" ||
        event.error === "audio-capture"
      ) {
        stoppedByUserRef.current = true;
        setIsListening(false);
      }

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was denied");
      } else if (event.error === "audio-capture") {
        setError("No microphone was found");
      } else {
        setError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      // Guard against superseded instances: if this recognizer has been replaced by a newer one,
      // don't restart or touch any state — let the new instance handle everything.
      if (recognitionRef.current !== recognition) return;

      if (!stoppedByUserRef.current) {
        try {
          recognition.start();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to start speech recognition");
        }
        return;
      }
      recognitionRef.current = null;
      setIsListening(false);
    };

    stoppedByUserRef.current = false;
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start speech recognition");
      recognitionRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    stoppedByUserRef.current = true;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    // `stop()` owns the listening -> idle transition instead of deferring it to `onend`: the
    // browser fires `end` asynchronously, long after `stop()` has returned and cleared the ref, so
    // by then `onend`'s superseded-instance guard bails out and any state set there never lands.
    setIsListening(false);
    recognition?.stop();
  }, []);

  useEffect(() => {
    return () => {
      stoppedByUserRef.current = true;
      recognitionRef.current?.stop();
    };
  }, []);

  return { isSupported, isListening, error, start, stop };
}
