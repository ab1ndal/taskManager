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

/**
 * `webkitSpeechRecognition` exists as a constructor in iOS Safari, but does not actually work once
 * the app is running standalone (added to the Home Screen) — confirmed against Apple's own
 * developer forums, not assumed from a general "iOS" rule. `recognition.start()` ends the session
 * almost immediately with no real listening, which without this check hits the auto-restart branch
 * in `onend` below over and over and hangs the app in a tight start/end cycle. Safari in an
 * ordinary browser tab is unaffected — the check is standalone display mode, not iOS as a whole —
 * so this only removes the in-app mic there; the iOS keyboard's own dictation still works on
 * whatever text field has focus, same as the grocery dictation sheet already relies on.
 */
function isIosSpeechRecognitionBroken(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as "MacIntel" with touch support, unlike any real Mac.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) return false;

  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Whether the constructor exists never changes after load, so there is nothing to subscribe to. */
function subscribeToNothing() {
  return () => {};
}

function getIsSupported() {
  return getConstructor() !== null && !isIosSpeechRecognitionBroken();
}

/**
 * A genuine silence-timeout restart is seconds apart from the last one. A recognizer that ends
 * immediately every time it starts — the iOS-standalone case above manifests exactly like this,
 * and it is the failure mode `isIosSpeechRecognitionBroken` exists to head off — would otherwise
 * retry forever with no backoff and peg the CPU. This is a second, platform-independent guard: if
 * `isIosSpeechRecognitionBroken` misses a case (a future WebKit change, a different broken
 * platform), the loop still cannot run away.
 */
const RAPID_RESTART_WINDOW_MS = 3000;
const RAPID_RESTART_LIMIT = 5;

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
  // Timestamps of recent onend-triggered restarts, oldest first. A real result clears it — that
  // proves this session is actually listening, not just churning through start/end.
  const restartTimestampsRef = useRef<number[]>([]);

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
      restartTimestampsRef.current = [];
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
        const now = Date.now();
        restartTimestampsRef.current = [...restartTimestampsRef.current, now].filter(
          (t) => now - t < RAPID_RESTART_WINDOW_MS
        );
        if (restartTimestampsRef.current.length > RAPID_RESTART_LIMIT) {
          stoppedByUserRef.current = true;
          recognitionRef.current = null;
          setIsListening(false);
          setError("Speech recognition stopped responding — try typing instead");
          return;
        }
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
    restartTimestampsRef.current = [];
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
