import { renderHook, act } from "@testing-library/react";
import { useSpeechRecognition } from "./use-speech-recognition";

type Listener = (event: unknown) => void;

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  onresult: Listener | null = null;
  onend: (() => void) | null = null;
  onerror: Listener | null = null;
  start = jest.fn();
  stop = jest.fn(() => this.onend?.());
}

describe("useSpeechRecognition", () => {
  const originalSR = (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;

  afterEach(() => {
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = originalSR;
  });

  it("reports unsupported when no SpeechRecognition constructor exists", () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    const { result } = renderHook(() => useSpeechRecognition(() => {}));

    expect(result.current.isSupported).toBe(false);
  });

  it("starts listening and forwards results to onResult", () => {
    let instance: MockSpeechRecognition | null = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      instance = new MockSpeechRecognition();
      return instance;
    });

    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    expect(result.current.isSupported).toBe(true);

    act(() => result.current.start());
    expect(result.current.isListening).toBe(true);
    expect(instance!.start).toHaveBeenCalled();

    act(() => {
      instance!.onresult?.({
        results: [[{ transcript: "hello" }]].map((r) => Object.assign(r, { isFinal: true, 0: r[0] })),
      });
    });
    expect(onResult).toHaveBeenCalledWith("hello", true);
  });

  it("auto-restarts on onend unless the user explicitly stopped", () => {
    let instance: MockSpeechRecognition | null = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      instance = new MockSpeechRecognition();
      return instance;
    });

    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => result.current.start());
    instance!.start.mockClear();

    // Simulate Chrome ending the session on silence.
    act(() => instance!.onend?.());

    expect(instance!.start).toHaveBeenCalledTimes(1);
    expect(result.current.isListening).toBe(true);
  });

  it("does not restart after the user explicitly calls stop", () => {
    let instance: MockSpeechRecognition | null = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      instance = new MockSpeechRecognition();
      return instance;
    });

    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => result.current.start());
    act(() => result.current.stop());

    expect(result.current.isListening).toBe(false);
  });
});
