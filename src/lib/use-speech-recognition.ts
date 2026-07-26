"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
 * Wraps the browser's SpeechRecognition API. Chrome ends a session on silence even with
 * `continuous: true`, so `onend` auto-restarts unless `stop()` was called explicitly — tracked via
 * `stoppedByUserRef` rather than `isListening` state, since state updates inside the `onend`
 * callback would be stale by the time the callback reads them.
 */
export function useSpeechRecognition(onResult: (transcript: string, isFinal: boolean) => void) {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stoppedByUserRef = useRef(true);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    setIsSupported(getConstructor() !== null);
  }, []);

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
      if (event.error === "not-allowed") setError("Microphone access was denied");
    };

    recognition.onend = () => {
      if (!stoppedByUserRef.current) {
        try {
          recognition.start();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to start speech recognition");
        }
        return;
      }
      setIsListening(false);
    };

    stoppedByUserRef.current = false;
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start speech recognition");
      recognitionRef.current = null;
    }
    setIsListening(true);
  }, []);

  const stop = useCallback(() => {
    stoppedByUserRef.current = true;
    recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      stoppedByUserRef.current = true;
      recognitionRef.current?.stop();
    };
  }, []);

  return { isSupported, isListening, error, start, stop };
}
