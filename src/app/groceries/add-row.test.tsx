import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AddRow } from "./add-row";
import type { GroceryItem } from "./types";

jest.mock("./actions", () => ({ addGroceryItem: jest.fn(async () => ({ ok: true, itemId: "g9" })) }));

// Same pattern as new-task-modal.test.tsx / edit-task-modal.test.tsx: a bare jest.fn() spy, so a
// toast call can be asserted without mounting the real Toaster.
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { toast } from "@/components/toaster";

beforeEach(() => {
  jest.clearAllMocks();
});

const items: GroceryItem[] = [
  {
    id: "g1",
    name: "Oat milk",
    category: "dairy",
    inStock: false,
    needed: false,
    quantity: null,
    expiresOn: null,
    expiryIsEstimate: false,
    timesAdded: 12,
  },
];

const props = { workspaceId: "11111111-1111-4111-8111-111111111111", items, target: "list" as const };

it("suggests a past item as you type", () => {
  render(<AddRow {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: /add an item/i }), { target: { value: "oat" } });
  expect(screen.getByRole("button", { name: /oat milk/i })).toBeInTheDocument();
});

it("submits the typed name and keeps focus for the next item", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} />);
  const input = screen.getByRole("textbox", { name: /add an item/i });

  fireEvent.change(input, { target: { value: "Coriander" } });
  fireEvent.submit(input.closest("form")!);

  await waitFor(() =>
    expect(addGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Coriander", target: "list" }),
    ),
  );
  await waitFor(() => expect(input).toHaveFocus());
});

// Regression: a rejected action promise (dropped connection, mid-flight navigation) used to
// vanish silently — no toast, no state change, no log. The user taps Add and nothing tells them why.
it("toasts when the action call rejects instead of failing silently", async () => {
  const { addGroceryItem } = await import("./actions");
  jest.mocked(addGroceryItem).mockRejectedValueOnce(new Error("network dropped"));

  render(<AddRow {...props} />);
  const input = screen.getByRole("textbox", { name: /add an item/i });
  fireEvent.change(input, { target: { value: "Coriander" } });
  fireEvent.submit(input.closest("form")!);

  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith("Something went wrong. Please try again.", "error"),
  );
});

it("does not submit an empty name", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} />);
  fireEvent.submit(screen.getByRole("textbox", { name: /add an item/i }).closest("form")!);
  expect(addGroceryItem).not.toHaveBeenCalled();
});

// Regression: picking a suggestion used to submit whatever the selector held, because
// setCategory() does not change the binding the current render closed over. grocery_upsert
// overwrites the category, so a Dairy item re-added this way silently became Pantry and lost its
// shelf-life estimate for every later purchase.
it("submits the suggestion's own category, not the selector's", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} />);

  fireEvent.change(screen.getByRole("textbox", { name: /add an item/i }), {
    target: { value: "oat" },
  });
  fireEvent.click(screen.getByRole("button", { name: /oat milk/i }));

  await waitFor(() =>
    expect(addGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Oat milk", category: "dairy" }),
    ),
  );
});

// Regression (Critical 1): the typed path — fill a name, press Enter, selector untouched — always
// sent category "pantry". grocery_upsert overwrote the column on conflict, so re-adding an
// existing Dairy item this way rewrote it to Pantry and destroyed its shelf-life estimate. Only
// the suggestion-chip path was ever tested. The selector now speaks only when the user has moved
// it; "no category" means "keep what is stored".
it("omits the category on a typed add when the selector was untouched", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} />);
  const input = screen.getByRole("textbox", { name: /add an item/i });

  fireEvent.change(input, { target: { value: "Oat milk" } });
  fireEvent.submit(input.closest("form")!);

  await waitFor(() => expect(addGroceryItem).toHaveBeenCalled());
  expect(jest.mocked(addGroceryItem).mock.calls[0][0]).not.toHaveProperty("category");
});

it("sends the category once the user actually picks one", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} />);

  fireEvent.change(screen.getByRole("combobox", { name: /category/i }), {
    target: { value: "frozen" },
  });
  const input = screen.getByRole("textbox", { name: /add an item/i });
  fireEvent.change(input, { target: { value: "Peas" } });
  fireEvent.submit(input.closest("form")!);

  await waitFor(() =>
    expect(addGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Peas", category: "frozen" }),
    ),
  );
});
