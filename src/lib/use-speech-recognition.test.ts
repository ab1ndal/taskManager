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

  it("guards against concurrent start() calls and does not create a second instance", () => {
    let instanceCount = 0;
    let firstInstance: MockSpeechRecognition | null = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      instanceCount++;
      const instance = new MockSpeechRecognition();
      if (instanceCount === 1) {
        firstInstance = instance;
      }
      return instance;
    });

    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => result.current.start());
    expect(instanceCount).toBe(1);

    // Call start() again before the first session ends — should be a no-op.
    act(() => result.current.start());
    expect(instanceCount).toBe(1); // Still only one instance created.
  });

  it("catches exceptions from recognition.start() and surfaces them via error state", () => {
    let instance: MockSpeechRecognition | null = null;
    let startCallCount = 0;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      instance = new MockSpeechRecognition();
      // Mock start() to throw on the second call.
      instance.start.mockImplementation(() => {
        startCallCount++;
        if (startCallCount === 2) {
          throw new Error("InvalidStateError: recognition already started");
        }
      });
      return instance;
    });

    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => result.current.start());
    expect(result.current.error).toBeNull();
    expect(startCallCount).toBe(1);

    // Simulate Chrome ending the session on silence.
    // The onend handler tries to auto-restart, which should throw.
    act(() => instance!.onend?.());

    // The error should be caught and set in the error state.
    expect(result.current.error).toBe("InvalidStateError: recognition already started");
  });

  it("allows starting a second session after stop() — does not silently no-op", () => {
    let instanceCount = 0;
    let lastInstance: MockSpeechRecognition | null = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      instanceCount++;
      lastInstance = new MockSpeechRecognition();
      return lastInstance;
    });

    const { result } = renderHook(() => useSpeechRecognition(() => {}));

    act(() => result.current.start());
    expect(instanceCount).toBe(1);
    expect(result.current.isListening).toBe(true);

    act(() => result.current.stop());
    expect(result.current.isListening).toBe(false);

    act(() => result.current.start());
    expect(instanceCount).toBe(2);
    expect(result.current.isListening).toBe(true);
  });

  it("treats a not-allowed error as terminal and does not loop-restart via onend", () => {
    let instance: MockSpeechRecognition | null = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      instance = new MockSpeechRecognition();
      return instance;
    });

    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => result.current.start());
    instance!.start.mockClear();

    act(() => instance!.onerror?.({ error: "not-allowed" }));
    act(() => instance!.onend?.());

    expect(instance!.start).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
    expect(result.current.error).toBe("Microphone access was denied");
  });

  it("does not set isListening when the initial start() call throws", () => {
    let instance: MockSpeechRecognition | null = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      instance = new MockSpeechRecognition();
      // Mock start() to throw on the first call.
      instance.start.mockImplementation(() => {
        throw new Error("SecurityError: access denied");
      });
      return instance;
    });

    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => result.current.start());

    // isListening should be false since start() threw.
    expect(result.current.isListening).toBe(false);
    // error should be set.
    expect(result.current.error).toBe("SecurityError: access denied");
  });

  it("prevents a superseded recognizer instance from restarting itself after a concurrent start() call", () => {
    const instances: MockSpeechRecognition[] = [];
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      const instance = new MockSpeechRecognition();
      instances.push(instance);
      return instance;
    });

    const { result } = renderHook(() => useSpeechRecognition(() => {}));

    // Start the first recognizer instance (instances[0]).
    act(() => result.current.start());
    expect(instances.length).toBe(1);
    expect(result.current.isListening).toBe(true);
    instances[0]!.start.mockClear();

    // Stop the first instance synchronously and start a second one before the first's onend fires.
    // This simulates the race: stop() nulls the ref, then start() creates a new instance and
    // resets stoppedByUserRef to false.
    act(() => result.current.stop());
    act(() => result.current.start());

    // Now we have two instances and recognitionRef points to instances[1].
    expect(instances.length).toBe(2);
    expect(result.current.isListening).toBe(true);
    instances[1]!.start.mockClear();

    // Fire the FIRST instance's onend handler (the zombie).
    // Without the guard, it would restart itself because stoppedByUserRef is now false
    // and recognitionRef is pointing to instances[1], not instances[0].
    act(() => instances[0]!.onend?.());

    // Assert the zombie did NOT restart itself.
    expect(instances[0]!.start).not.toHaveBeenCalled();

    // Assert the second instance's state is undisturbed.
    expect(instances[1]!.start).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
  });
});
