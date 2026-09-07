import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AddRow } from "./add-row";
import type { GroceryItem } from "./types";

jest.mock("./actions", () => ({ addGroceryItem: jest.fn(async () => ({ ok: true, itemId: "g9" })) }));

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
