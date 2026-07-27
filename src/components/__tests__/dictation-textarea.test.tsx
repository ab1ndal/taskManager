import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DictationTextarea } from "@/components/dictation-textarea";
import { useDictation } from "@/lib/use-dictation";

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  start = jest.fn();
  // Deferred like a real browser's `end` event, which fires after `stop()` has returned.
  stop = jest.fn(() => {
    queueMicrotask(() => this.onend?.());
  });
}

/** Two fields sharing one controller — the arrangement every dictatable form uses. */
function TwoFieldForm() {
  const dictation = useDictation();
  const [details, setDetails] = useState("");
  const [update, setUpdate] = useState("");
  return (
    <>
      <DictationTextarea
        field="description"
        dictation={dictation}
        dictateLabel="Dictate task details"
        aria-label="Task details"
        value={details}
        onChange={setDetails}
      />
      <DictationTextarea
        field="update"
        dictation={dictation}
        dictateLabel="Dictate update"
        aria-label="Update"
        value={update}
        onChange={setUpdate}
      />
    </>
  );
}

describe("DictationTextarea", () => {
  let instances: MockSpeechRecognition[] = [];

  beforeEach(() => {
    instances = [];
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = jest.fn(() => {
      const instance = new MockSpeechRecognition();
      instances.push(instance);
      return instance;
    });
  });

  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  function fireResult(transcript: string, isFinal: boolean) {
    instances[instances.length - 1].onresult?.({ results: [{ 0: { transcript }, isFinal }] });
  }

  it("renders no mic button when SpeechRecognition is unsupported", () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    render(<TwoFieldForm />);
    expect(screen.queryByRole("button", { name: /dictate/i })).not.toBeInTheDocument();
  });

  it("keeps the newest dictated text in view, since replacing the value never scrolls the field", async () => {
    render(<TwoFieldForm />);
    const field = screen.getByLabelText("Task details") as HTMLTextAreaElement;
    // jsdom has no layout, so the overflow a real dictation produces has to be declared.
    Object.defineProperty(field, "scrollHeight", { value: 240, configurable: true });
    field.scrollTop = 0;

    await userEvent.click(screen.getByRole("button", { name: /dictate task details/i }));
    await act(async () => fireResult("a long dictated passage", false));

    expect(field.scrollTop).toBe(240);
  });

  it("moves the single session to the field that claims it, so two recognizers never overlap", async () => {
    render(<TwoFieldForm />);

    await userEvent.click(screen.getByRole("button", { name: /dictate task details/i }));
    await act(async () => fireResult("into details", true));
    await userEvent.click(screen.getByRole("button", { name: /dictate update/i }));
    await act(async () => fireResult("into the update", true));

    expect(instances[0].stop).toHaveBeenCalled();
    expect(screen.getByLabelText("Task details")).toHaveValue("into details");
    expect(screen.getByLabelText("Update")).toHaveValue("into the update");
  });

  it("labels the active field's button as a stop control, and only that field's", async () => {
    render(<TwoFieldForm />);

    await userEvent.click(screen.getByRole("button", { name: /dictate task details/i }));

    expect(screen.getByRole("button", { name: /stop dictating/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dictate update/i })).toBeInTheDocument();
  });

  it("appends a second utterance to what the first committed rather than replacing it", async () => {
    render(<TwoFieldForm />);

    await userEvent.click(screen.getByRole("button", { name: /dictate task details/i }));
    await act(async () => fireResult("first sentence", true));
    await act(async () => fireResult("second sentence", true));

    expect(screen.getByLabelText("Task details")).toHaveValue("first sentence second sentence");
  });

  it("reports a permission failure under the field that was dictating", async () => {
    render(<TwoFieldForm />);

    await userEvent.click(screen.getByRole("button", { name: /dictate task details/i }));
    await act(async () => {
      instances[0].onerror?.({ error: "not-allowed" });
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Microphone access was denied");
    // The session is over, so the button goes back to offering to start a new one.
    expect(screen.getByRole("button", { name: /dictate task details/i })).toBeInTheDocument();
  });

  it("treats text typed into the dictating field as the base the next utterance appends to", async () => {
    render(<TwoFieldForm />);

    await userEvent.click(screen.getByRole("button", { name: /dictate task details/i }));
    await userEvent.type(screen.getByLabelText("Task details"), "typed");
    await act(async () => fireResult("spoken", true));

    expect(screen.getByLabelText("Task details")).toHaveValue("typed spoken");
  });
});
