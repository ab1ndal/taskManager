import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Server actions are stubbed: these tests are about what the row renders, not what it writes.
jest.mock("./actions", () => ({
  setNeeded: jest.fn(async () => ({ ok: true, itemId: "g1" })),
  markBought: jest.fn(async () => ({ ok: true, itemId: "g1" })),
  finishItem: jest.fn(async () => ({ ok: true, itemId: "g1" })),
  adjustQuantity: jest.fn(async () => ({ ok: true, itemId: "g1" })),
  editItem: jest.fn(async () => ({ ok: true, itemId: "g1" })),
  forgetItem: jest.fn(async () => ({ ok: true })),
}));

// Same pattern as new-task-modal.test.tsx / edit-task-modal.test.tsx: a bare jest.fn() spy, so a
// toast call can be asserted without mounting the real Toaster.
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { PantryRow, ShoppingRow } from "./item-row";
import { editItem, markBought } from "./actions";
import { toast } from "@/components/toaster";
import type { GroceryItem } from "./types";

const base: GroceryItem = {
  id: "g1",
  name: "Spinach",
  category: "produce",
  inStock: true,
  needed: false,
  quantity: null,
  expiresOn: "2026-09-13",
  expiryIsEstimate: true,
  timesAdded: 1,
};

beforeEach(() => jest.clearAllMocks());

describe("PantryRow", () => {
  it("marks an estimated expiry with a tilde", () => {
    render(<PantryRow item={base} today="2026-09-06" />);
    expect(screen.getByText(/~/)).toBeInTheDocument();
  });

  it("shows a plain date when the expiry is known", () => {
    render(<PantryRow item={{ ...base, expiryIsEstimate: false }} today="2026-09-06" />);
    expect(screen.queryByText(/~/)).not.toBeInTheDocument();
  });

  it("labels an expired item and offers Still good", () => {
    render(<PantryRow item={{ ...base, expiresOn: "2026-09-01" }} today="2026-09-06" />);
    expect(screen.getByText("expired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /still good/i })).toBeInTheDocument();
  });

  it("shows a stepper only when the item has a count", () => {
    const { rerender } = render(<PantryRow item={base} today="2026-09-06" />);
    expect(screen.queryByRole("button", { name: /one fewer/i })).not.toBeInTheDocument();

    rerender(<PantryRow item={{ ...base, quantity: 6 }} today="2026-09-06" />);
    expect(screen.getByRole("button", { name: /one fewer/i })).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("reflects the Need state in the toggle", () => {
    render(<PantryRow item={{ ...base, needed: true }} today="2026-09-06" />);
    expect(screen.getByRole("button", { name: /need/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  // Regression: a flat 7-day nudge is wrong for most categories — frozen food pushed out by a
  // week reads as expired again next week. "Still good" has to read the category's own shelf
  // life. produce's shelf life is also 7, so it can't tell the two behaviours apart — this uses
  // dairy (10) instead.
  it("still good pushes the expiry out by the category's shelf life, not a flat week", async () => {
    const dairyItem: GroceryItem = { ...base, category: "dairy", expiresOn: "2026-09-01" };
    render(<PantryRow item={dairyItem} today="2026-09-06" />);

    fireEvent.click(screen.getByRole("button", { name: /still good/i }));

    await waitFor(() => {
      expect(editItem).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: "g1", expiresOn: "2026-09-16" }),
      );
    });
  });
});

describe("ShoppingRow", () => {
  // Regression: a rejected action promise (dropped connection, mid-flight navigation) used to
  // vanish silently — no toast, no state change, no log. The user taps and nothing tells them why.
  it("toasts when the action call rejects instead of failing silently", async () => {
    jest.mocked(markBought).mockRejectedValueOnce(new Error("network dropped"));

    render(<ShoppingRow item={{ ...base, needed: true, inStock: false }} />);
    fireEvent.click(screen.getByRole("button", { name: /bought spinach/i }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("Something went wrong. Please try again.", "error"),
    );
  });

  it("shows how many we already have when it is also in the pantry", () => {
    render(<ShoppingRow item={{ ...base, needed: true, inStock: true, quantity: 6 }} />);
    expect(screen.getByText("have 6")).toBeInTheDocument();
  });

  it("shows no quantity line when we have none", () => {
    render(<ShoppingRow item={{ ...base, needed: true, inStock: false, quantity: null }} />);
    expect(screen.queryByText(/^have /)).not.toBeInTheDocument();
  });

  it("names the bought control after the item", () => {
    render(<ShoppingRow item={{ ...base, needed: true, inStock: false }} />);
    expect(screen.getByRole("button", { name: /bought spinach/i })).toBeInTheDocument();
  });
});
