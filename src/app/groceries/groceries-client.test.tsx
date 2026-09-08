import { fireEvent, render, screen } from "@testing-library/react";

// The client tree reaches server actions through AddRow and the rows, useForegroundRefresh needs a
// router, and TabPill (rendered by GroceriesClient itself) needs useSearchParams. All three are
// stubbed so these tests stay about rendering and filtering.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("./actions", () => ({
  addGroceryItem: jest.fn(async () => ({ ok: true, itemId: "g9" })),
  setNeeded: jest.fn(async () => ({ ok: true, itemId: "g1" })),
  markBought: jest.fn(async () => ({ ok: true, itemId: "g1" })),
  finishItem: jest.fn(async () => ({ ok: true, itemId: "g1" })),
  adjustQuantity: jest.fn(async () => ({ ok: true, itemId: "g1" })),
  editItem: jest.fn(async () => ({ ok: true, itemId: "g1" })),
  forgetItem: jest.fn(async () => ({ ok: true })),
}));

import { GroceriesClient } from "./groceries-client";
import type { GroceryItem } from "./types";

const items: GroceryItem[] = [
  { id: "g1", name: "Rice", category: "pantry", inStock: true, needed: false,
    quantity: null, expiresOn: null, expiryIsEstimate: false, timesAdded: 4 , lots: []},
  { id: "g2", name: "Milk", category: "dairy", inStock: false, needed: true,
    quantity: null, expiresOn: null, expiryIsEstimate: false, timesAdded: 9 , lots: []},
  { id: "g3", name: "Spinach", category: "produce", inStock: true, needed: true,
    quantity: null, expiresOn: "2026-09-07", expiryIsEstimate: true, timesAdded: 2 , lots: []},
  { id: "g4", name: "Old thing", category: "pantry", inStock: false, needed: false,
    quantity: null, expiresOn: null, expiryIsEstimate: false, timesAdded: 1 , lots: []},
];

const props = { workspaceId: "11111111-1111-4111-8111-111111111111", items, today: "2026-09-06" };

describe("GroceriesClient", () => {
  it("shows in-stock items in the pantry view, archived excluded", () => {
    render(<GroceriesClient {...props} view="stock" />);
    expect(screen.getByText("Rice")).toBeInTheDocument();
    expect(screen.getByText("Spinach")).toBeInTheDocument();
    expect(screen.queryByText("Milk")).not.toBeInTheDocument();
    expect(screen.queryByText("Old thing")).not.toBeInTheDocument();
  });

  it("shows needed items in the shopping view, including one we still have", () => {
    render(<GroceriesClient {...props} view="buy" />);
    expect(screen.getByText("Milk")).toBeInTheDocument();
    expect(screen.getByText("Spinach")).toBeInTheDocument();
    expect(screen.queryByText("Rice")).not.toBeInTheDocument();
  });

  it("offers the sort control in the pantry only", () => {
    const { rerender } = render(<GroceriesClient {...props} view="stock" />);
    expect(screen.getByRole("group", { name: /sort/i })).toBeInTheDocument();

    rerender(<GroceriesClient {...props} view="buy" />);
    expect(screen.queryByRole("group", { name: /sort/i })).not.toBeInTheDocument();
  });

  it("hides the category filter until a view gets long", () => {
    render(<GroceriesClient {...props} view="stock" />);
    expect(screen.queryByRole("group", { name: /filter/i })).not.toBeInTheDocument();
  });

  // Regression: the threshold used to read the already-filtered count, so picking a small category
  // in a long list hid the whole bar — "All" included — while the filter stayed active, with no way
  // back to the full list.
  it("keeps the filter bar reachable after selecting a small category", () => {
    const many: GroceryItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      name: `Item ${String(i).padStart(2, "0")}`,
      category: i < 3 ? "dairy" : "pantry",
      inStock: true,
      needed: false,
      quantity: null,
      expiresOn: null,
      expiryIsEstimate: false,
      timesAdded: 1, lots: [],
    }));

    render(<GroceriesClient {...props} items={many} view="stock" />);
    const filter = screen.getByRole("group", { name: /filter/i });

    fireEvent.click(screen.getByRole("button", { name: /dairy/i }));

    expect(filter).toBeInTheDocument();
    const all = screen.getByRole("button", { name: "All" });
    fireEvent.click(all);
    expect(screen.getAllByText(/^Item /)).toHaveLength(20);
  });

  it("shows an empty state when a view has nothing", () => {
    render(<GroceriesClient {...props} items={[]} view="buy" />);
    expect(screen.getByText(/list is empty/i)).toBeInTheDocument();
  });
});

it("retains the selected workspace in both view links", () => {
  render(<GroceriesClient {...props} view="buy" />);
  for (const [label, view] of [["Shopping list", "buy"], ["Pantry", "stock"]]) {
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", `/groceries?view=${view}&workspace=${props.workspaceId}`);
  }
});

it("shopping ignores a pantry category filter and shows no category controls", () => {
  const many = Array.from({ length: 20 }, (_, i): GroceryItem => ({
    ...props.items[0], id: `m${i}`, name: `Product ${i}`, category: i < 3 ? "dairy" : "pantry", needed: true,
  }));
  const { rerender } = render(<GroceriesClient {...props} items={many} view="stock" />);
  fireEvent.click(screen.getByRole("button", { name: /dairy/i }));
  rerender(<GroceriesClient {...props} items={many} view="buy" />);
  expect(screen.queryByRole("group", { name: /filter/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Category" })).not.toBeInTheDocument();
  expect(screen.getAllByText(/^Product /)).toHaveLength(20);
});
