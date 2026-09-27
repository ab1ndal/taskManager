"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Container types to ask MediaRecorder for, in preference order. Both are accepted by OpenAI's
 * transcription endpoint; Safari (including the installed iPhone app) records `audio/mp4`, Chrome
 * and Firefox record `audio/webm`. Firefox's own default, Ogg, is not accepted — which is why the
 * type is always requested explicitly rather than left to the browser.
 */
const PREFERRED_MIME_TYPES = ["audio/webm", "audio/mp4"] as const;

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

function getIsSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && pickMimeType() !== null;
}

/** Support never changes after load, so there is nothing to subscribe to. */
function subscribeToNothing() {
  return () => {};
}

/** `starting` covers the permission prompt: getUserMedia can sit unresolved while the user decides. */
export type RecorderStatus = "idle" | "starting" | "recording";

interface Session {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Cleared by `cancel()`: the recording still stops, but nothing is handed to the caller. */
  deliver: boolean;
}

function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access was denied";
  if (name === "NotFoundError") return "No microphone was found";
  return "Couldn't start recording — try again";
}

/**
 * Records one clip from the microphone and hands it to `onRecorded` when it stops.
 *
 * Unlike `useSpeechRecognition`, this works in the installed iPhone app: getUserMedia and
 * MediaRecorder function in standalone mode where `webkitSpeechRecognition` does not (docs/ios.md).
 *
 * The clip lives only in memory — the chunks are dropped once the Blob is handed over — and the
 * microphone tracks are stopped on every path out of a recording, so the OS mic indicator never
 * outlives it. A recording stops itself at `maxDurationMs` and when the page is hidden (the app is
 * backgrounded or the phone locks), delivering what was captured so far; `cancel()` stops without
 * delivering, for a sheet that was closed mid-recording.
 */
export function useAudioRecorder({
  onRecorded,
  maxDurationMs,
  audioBitsPerSecond,
}: {
  onRecorded: (audio: Blob) => void;
  maxDurationMs: number;
  audioBitsPerSecond: number;
}) {
  // Browser-only fact, read with a `false` server snapshot so hydration agrees (no mic button).
  const isSupported = useSyncExternalStore(subscribeToNothing, getIsSupported, () => false);
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const onRecordedRef = useRef(onRecorded);

  // Written in an effect, not during render; recordings only finish after it has run.
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  const finish = useCallback((deliver: boolean) => {
    const session = sessionRef.current;
    if (!session) return;
    session.deliver = session.deliver && deliver;
    if (session.timer) clearTimeout(session.timer);

    if (session.recorder && session.recorder.state !== "inactive") {
      // `onstop` releases the tracks and delivers once the final chunk has been flushed.
      session.recorder.stop();
      return;
    }
    // Still waiting on the permission prompt: nothing recorded yet. `start` sees the session was
    // superseded when getUserMedia resolves and releases the stream itself.
    session.stream?.getTracks().forEach((track) => track.stop());
    sessionRef.current = null;
    setStatus("idle");
  }, []);

  const stop = useCallback(() => finish(true), [finish]);
  const cancel = useCallback(() => finish(false), [finish]);

  const start = useCallback(async () => {
    const mimeType = pickMimeType();
    if (sessionRef.current || !mimeType || !navigator.mediaDevices?.getUserMedia) return;

    const session: Session = { stream: null, recorder: null, timer: null, deliver: true };
    sessionRef.current = session;
    setError(null);
    setStatus("starting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (sessionRef.current === session) {
        sessionRef.current = null;
        setStatus("idle");
        setError(micErrorMessage(err));
      }
      return;
    }

    // Cancelled or stopped while the permission prompt was open.
    if (sessionRef.current !== session) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    session.stream = stream;

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond });
    session.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (session.timer) clearTimeout(session.timer);
      if (sessionRef.current === session) sessionRef.current = null;
      setStatus("idle");
      if (session.deliver && chunks.length > 0) {
        onRecordedRef.current(new Blob(chunks, { type: recorder.mimeType || mimeType }));
      }
      chunks.length = 0;
    };

    try {
      recorder.start();
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      sessionRef.current = null;
      setStatus("idle");
      setError(micErrorMessage(err));
      return;
    }
    session.timer = setTimeout(() => finish(true), maxDurationMs);
    setStatus("recording");
  }, [audioBitsPerSecond, finish, maxDurationMs]);

  // iOS cuts the microphone when the app is backgrounded; stopping here delivers what was said
  // before that instead of leaving a recorder that silently captures nothing.
  useEffect(() => {
    if (status === "idle") return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") finish(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [finish, status]);

  // Unmounting mid-recording (navigating away) must release the microphone and send nothing.
  useEffect(() => () => finish(false), [finish]);

  return { isSupported, status, error, start, stop, cancel };
}
