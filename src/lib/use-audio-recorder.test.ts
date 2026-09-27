import { act, renderHook } from "@testing-library/react";

import { useAudioRecorder } from "./use-audio-recorder";

/**
 * Browser-shaped fake: `stop()` flushes the last chunk and fires `onstop` on a later task, not
 * synchronously — a synchronous fake hid a real ordering bug in useSpeechRecognition once.
 */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supported = new Set(["audio/webm", "audio/mp4"]);
  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supported.has(type);
  }

  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    readonly stream: MediaStream,
    readonly options: { mimeType: string; audioBitsPerSecond: number },
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  get mimeType() {
    return this.options.mimeType;
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["audio bytes"], { type: this.options.mimeType }) });
      this.onstop?.();
    });
  }
}

function fakeStream() {
  const track = { stop: jest.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

const getUserMedia = jest.fn();
const onRecorded = jest.fn();

beforeEach(() => {
  // queueMicrotask stays real: the fake recorder uses it to fire onstop, and faking it would leave
  // every stop() pending until some unrelated timer advance happened to flush it.
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  jest.clearAllMocks();
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = new Set(["audio/webm", "audio/mp4"]);
  Object.defineProperty(global, "MediaRecorder", { value: FakeMediaRecorder, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

afterEach(() => {
  jest.useRealTimers();
});

function renderRecorder() {
  return renderHook(() => useAudioRecorder({ onRecorded, maxDurationMs: 120_000, audioBitsPerSecond: 64_000 }));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

it("records, then hands the clip over and releases the mic on stop", async () => {
  const { stream, track } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const { result } = renderRecorder();

  await act(() => result.current.start());
  expect(result.current.status).toBe("recording");
  expect(FakeMediaRecorder.instances[0].options).toEqual({ mimeType: "audio/webm", audioBitsPerSecond: 64_000 });

  act(() => result.current.stop());
  await flush();

  expect(result.current.status).toBe("idle");
  expect(track.stop).toHaveBeenCalled();
  expect(onRecorded).toHaveBeenCalledTimes(1);
  expect(onRecorded.mock.calls[0][0].type).toBe("audio/webm");
});

it("falls back to mp4 where webm cannot be recorded (Safari)", async () => {
  FakeMediaRecorder.supported = new Set(["audio/mp4"]);
  getUserMedia.mockResolvedValue(fakeStream().stream);
  const { result } = renderRecorder();

  await act(() => result.current.start());

  expect(FakeMediaRecorder.instances[0].options.mimeType).toBe("audio/mp4");
});

it("is unsupported when neither accepted format can be recorded", () => {
  FakeMediaRecorder.supported = new Set(["audio/ogg"]);
  const { result } = renderRecorder();
  expect(result.current.isSupported).toBe(false);
});

it("cancel releases the mic without handing anything over", async () => {
  const { stream, track } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const { result } = renderRecorder();

  await act(() => result.current.start());
  act(() => result.current.cancel());
  await flush();

  expect(track.stop).toHaveBeenCalled();
  expect(onRecorded).not.toHaveBeenCalled();
  expect(result.current.status).toBe("idle");
});

it("stops itself at the duration cap and delivers what it has", async () => {
  getUserMedia.mockResolvedValue(fakeStream().stream);
  const { result } = renderRecorder();

  await act(() => result.current.start());
  act(() => jest.advanceTimersByTime(120_000));
  await flush();

  expect(onRecorded).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe("idle");
});

it("stops and delivers when the app is backgrounded", async () => {
  getUserMedia.mockResolvedValue(fakeStream().stream);
  const { result } = renderRecorder();

  await act(() => result.current.start());
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await flush();

  expect(onRecorded).toHaveBeenCalledTimes(1);
});

it("reports a denied permission and returns to idle", async () => {
  getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  const { result } = renderRecorder();

  await act(() => result.current.start());

  expect(result.current.status).toBe("idle");
  expect(result.current.error).toBe("Microphone access was denied");
});

it("releases a stream granted after the user already cancelled at the permission prompt", async () => {
  const { stream, track } = fakeStream();
  let grant: (stream: MediaStream) => void = () => {};
  getUserMedia.mockReturnValue(new Promise<MediaStream>((resolve) => (grant = resolve)));
  const { result } = renderRecorder();

  let starting: Promise<void> = Promise.resolve();
  act(() => {
    starting = result.current.start();
  });
  expect(result.current.status).toBe("starting");
  act(() => result.current.cancel());
  await act(async () => {
    grant(stream);
    await starting;
  });

  expect(track.stop).toHaveBeenCalled();
  expect(FakeMediaRecorder.instances).toHaveLength(0);
  expect(result.current.status).toBe("idle");
});

it("releases the mic without delivering when unmounted mid-recording", async () => {
  const { stream, track } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const { result, unmount } = renderRecorder();

  await act(() => result.current.start());
  unmount();
  await flush();

  expect(track.stop).toHaveBeenCalled();
  expect(onRecorded).not.toHaveBeenCalled();
});
