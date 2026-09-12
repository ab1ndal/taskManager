import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DictateSheet } from "./dictate-sheet";

jest.mock("./actions", () => ({ addGroceryItem: jest.fn(async () => ({ ok: true, itemId: "g9" })) }));
jest.mock("./dictate-actions", () => ({ parseGroceryDictation: jest.fn() }));
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { addGroceryItem } from "./actions";
import { parseGroceryDictation } from "./dictate-actions";
import { toast } from "@/components/toaster";

beforeEach(() => {
  jest.clearAllMocks();
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
