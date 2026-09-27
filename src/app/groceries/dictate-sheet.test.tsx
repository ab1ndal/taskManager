import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DictateSheet } from "./dictate-sheet";

jest.mock("./actions", () => ({ addGroceryItem: jest.fn(async () => ({ ok: true, itemId: "g9" })) }));
jest.mock("./dictate-actions", () => ({ parseGroceryDictation: jest.fn() }));
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));
jest.mock("./transcribe-actions", () => ({ transcribeGroceryAudio: jest.fn() }));

/**
 * The recorder itself is covered by use-audio-recorder.test.ts; here it is a controllable stand-in
 * so the sheet's own wiring (what it does with a finished clip) is what gets tested. Unsupported by
 * default, which is also what jsdom — with no MediaRecorder — would report.
 */
const recorder = {
  isSupported: false,
  status: "idle" as "idle" | "starting" | "recording",
  error: null as string | null,
  start: jest.fn(async () => {}),
  stop: jest.fn(),
  cancel: jest.fn(),
  onRecorded: (() => {}) as (audio: Blob) => Promise<void> | void,
};
jest.mock("@/lib/use-audio-recorder", () => ({
  useAudioRecorder: ({ onRecorded }: { onRecorded: (audio: Blob) => Promise<void> | void }) => {
    recorder.onRecorded = onRecorded;
    return recorder;
  },
}));

import { addGroceryItem } from "./actions";
import { parseGroceryDictation } from "./dictate-actions";
import { transcribeGroceryAudio } from "./transcribe-actions";
import { toast } from "@/components/toaster";

beforeEach(() => {
  jest.clearAllMocks();
  recorder.isSupported = false;
  recorder.status = "idle";
  recorder.error = null;
});

const WORKSPACE = "11111111-1111-4111-8111-111111111111";

function open() {
  fireEvent.click(screen.getByRole("button", { name: /dictate items/i }));
}

it("is collapsed until the entry point is opened", () => {
  render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
  expect(screen.queryByLabelText(/dictated grocery list/i)).not.toBeInTheDocument();
  open();
  expect(screen.getByLabelText(/dictated grocery list/i)).toBeInTheDocument();
});

it("does not parse an empty transcript", () => {
  render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
  open();
  fireEvent.click(screen.getByRole("button", { name: /^parse$/i }));
  expect(parseGroceryDictation).not.toHaveBeenCalled();
});

it("shows editable review rows after a successful parse", async () => {
  jest.mocked(parseGroceryDictation).mockResolvedValue({
    ok: true,
    items: [
      { name: "Milk", quantity: null, category: "dairy", confidence: 0.95, lowConfidence: false, sourceText: "milk" },
    ],
  });

  render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
  open();
  fireEvent.change(screen.getByLabelText(/dictated grocery list/i), { target: { value: "milk" } });
  fireEvent.click(screen.getByRole("button", { name: /^parse$/i }));

  await waitFor(() => expect(screen.getByLabelText(/item name/i)).toHaveValue("Milk"));
  expect(screen.queryByLabelText(/^category$/i)).not.toBeInTheDocument();
});

it("flags a low-confidence row with its raw transcript fragment", async () => {
  jest.mocked(parseGroceryDictation).mockResolvedValue({
    ok: true,
    items: [
      {
        name: "olive oil", quantity: null, category: "pantry", confidence: 0.3,
        lowConfidence: true, sourceText: "we're low on olive oil",
      },
    ],
  });

  render(<DictateSheet workspaceId={WORKSPACE} target="stock" />);
  open();
  fireEvent.change(screen.getByLabelText(/dictated grocery list/i), { target: { value: "we're low on olive oil" } });
  fireEvent.click(screen.getByRole("button", { name: /^parse$/i }));

  await waitFor(() => expect(screen.getByText(/we're low on olive oil/i)).toBeInTheDocument());
  // Still editable, never blocked, per the confirmed low-confidence behaviour.
  expect(screen.getByLabelText(/item name/i)).not.toBeDisabled();
});

it("deletes a row before committing", async () => {
  jest.mocked(parseGroceryDictation).mockResolvedValue({
    ok: true,
    items: [
      { name: "Milk", quantity: null, category: "dairy", confidence: 0.95, lowConfidence: false, sourceText: "milk" },
      { name: "Eggs", quantity: 12, category: "dairy", confidence: 0.9, lowConfidence: false, sourceText: "dozen eggs" },
    ],
  });

  render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
  open();
  fireEvent.change(screen.getByLabelText(/dictated grocery list/i), { target: { value: "milk, dozen eggs" } });
  fireEvent.click(screen.getByRole("button", { name: /^parse$/i }));

  await waitFor(() => expect(screen.getAllByLabelText(/item name/i)).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: /remove milk/i }));

  expect(screen.getAllByLabelText(/item name/i)).toHaveLength(1);
  expect(screen.getByRole("button", { name: /add 1 item$/i })).toBeInTheDocument();
});

it("commits every surviving row through addGroceryItem, respecting the entry point's target", async () => {
  jest.mocked(parseGroceryDictation).mockResolvedValue({
    ok: true,
    items: [
      { name: "Milk", quantity: null, category: "dairy", confidence: 0.95, lowConfidence: false, sourceText: "milk" },
    ],
  });

  render(<DictateSheet workspaceId={WORKSPACE} target="stock" />);
  open();
  fireEvent.change(screen.getByLabelText(/dictated grocery list/i), { target: { value: "milk" } });
  fireEvent.click(screen.getByRole("button", { name: /^parse$/i }));
  await waitFor(() => expect(screen.getByLabelText(/item name/i)).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: /add 1 item/i }));

  await waitFor(() =>
    expect(addGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Milk", category: "dairy", quantity: null, target: "stock" }),
    ),
  );
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("Added 1 item")));
  await waitFor(() => expect(screen.queryByLabelText(/item name/i)).not.toBeInTheDocument());
});

it("keeps a failed row on screen with its error instead of losing it", async () => {
  jest.mocked(parseGroceryDictation).mockResolvedValue({
    ok: true,
    items: [
      { name: "Milk", quantity: null, category: "dairy", confidence: 0.95, lowConfidence: false, sourceText: "milk" },
    ],
  });
  jest.mocked(addGroceryItem).mockResolvedValue({ ok: false, error: "You already have an item with that name" });

  render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
  open();
  fireEvent.change(screen.getByLabelText(/dictated grocery list/i), { target: { value: "milk" } });
  fireEvent.click(screen.getByRole("button", { name: /^parse$/i }));
  await waitFor(() => expect(screen.getByLabelText(/item name/i)).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: /add 1 item/i }));

  await waitFor(() => expect(screen.getByText(/you already have an item/i)).toBeInTheDocument());
});

describe("recording", () => {
  const clip = new Blob(["audio"], { type: "audio/mp4" });

  beforeEach(() => {
    recorder.isSupported = true;
  });

  it("offers no Record button where the browser cannot record", () => {
    recorder.isSupported = false;
    render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
    open();
    expect(screen.queryByRole("button", { name: /record/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/dictated grocery list/i)).toHaveAttribute(
      "placeholder",
      expect.stringMatching(/keyboard mic/i),
    );
  });

  it("starts the recorder from the Record button", () => {
    render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /^record$/i }));
    expect(recorder.start).toHaveBeenCalled();
  });

  it("shows Stop while recording and blocks Parse", () => {
    recorder.status = "recording";
    render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
    open();
    fireEvent.change(screen.getByLabelText(/dictated grocery list/i), { target: { value: "milk" } });

    fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    expect(recorder.stop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^parse$/i })).toBeDisabled();
  });

  it("sends the finished clip with the workspace and appends the transcript to what was typed", async () => {
    jest.mocked(transcribeGroceryAudio).mockResolvedValue({ ok: true, text: "paneer and atta" });
    render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
    open();
    fireEvent.change(screen.getByLabelText(/dictated grocery list/i), { target: { value: "milk, " } });

    await act(() => recorder.onRecorded(clip));

    const sent = jest.mocked(transcribeGroceryAudio).mock.calls[0][0];
    expect(sent.get("workspaceId")).toBe(WORKSPACE);
    expect(sent.get("audio")).toBeInstanceOf(Blob);
    expect(screen.getByLabelText(/dictated grocery list/i)).toHaveValue("milk, paneer and atta");
    expect(parseGroceryDictation).not.toHaveBeenCalled();
  });

  it("shows Transcribing and blocks Parse until the transcript arrives", async () => {
    let reply: (value: { ok: true; text: string }) => void = () => {};
    jest.mocked(transcribeGroceryAudio).mockReturnValue(new Promise((resolve) => (reply = resolve)));
    render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
    open();

    let pending: Promise<void> | void;
    act(() => {
      pending = recorder.onRecorded(clip);
    });

    expect(screen.getByRole("button", { name: /transcribing/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^parse$/i })).toBeDisabled();

    await act(async () => {
      reply({ ok: true, text: "milk" });
      await pending;
    });
    expect(screen.getByRole("button", { name: /^record$/i })).toBeEnabled();
  });

  it("shows a transcription failure under the field and keeps what was typed", async () => {
    jest.mocked(transcribeGroceryAudio).mockResolvedValue({ ok: false, error: "Something went wrong" });
    render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
    open();
    fireEvent.change(screen.getByLabelText(/dictated grocery list/i), { target: { value: "milk" } });

    await act(() => recorder.onRecorded(clip));

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByLabelText(/dictated grocery list/i)).toHaveValue("milk");
  });

  it("shows the recorder's own error, such as a denied microphone", () => {
    recorder.error = "Microphone access was denied";
    render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
    open();
    expect(screen.getByRole("alert")).toHaveTextContent("Microphone access was denied");
  });

  it("cancels the recording and drops a transcript that returns after Cancel", async () => {
    let reply: (value: { ok: true; text: string }) => void = () => {};
    jest.mocked(transcribeGroceryAudio).mockReturnValue(new Promise((resolve) => (reply = resolve)));
    render(<DictateSheet workspaceId={WORKSPACE} target="list" />);
    open();

    let pending: Promise<void> | void;
    act(() => {
      pending = recorder.onRecorded(clip);
    });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(recorder.cancel).toHaveBeenCalled();

    await act(async () => {
      reply({ ok: true, text: "stale words" });
      await pending;
    });
    open();
    expect(screen.getByLabelText(/dictated grocery list/i)).toHaveValue("");
  });
});
