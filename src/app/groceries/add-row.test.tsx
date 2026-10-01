import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AddRow } from "./add-row";
import type { GroceryItem } from "./types";

jest.mock("./actions", () => ({ addGroceryItem: jest.fn(async () => ({ ok: true, itemId: "g9" })) }));
// AddRow mounts DictateSheet, which imports dictate-actions.ts, which imports the "ai" package —
// an ESM-only build jest cannot transform. Mocking the boundary these tests actually cross (same
// pattern as "./actions" above) avoids pulling that dependency in at all.
jest.mock("./dictate-actions", () => ({ parseGroceryDictation: jest.fn() }));

// Same pattern as new-task-modal.test.tsx / edit-task-modal.test.tsx: a bare jest.fn() spy, so a
// toast call can be asserted without mounting the real Toaster.
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));

import { toast } from "@/components/toaster";

// jsdom does not implement showModal(); the pantry add dialog needs it.
HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});

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
    timesAdded: 12, lotId: null,
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

it("opens the pantry add dialog instead of saving at once, with quantity 1", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} target="stock" />);
  const input = screen.getByRole("textbox", { name: /add an item/i });
  fireEvent.change(input, { target: { value: "Peas" } });
  fireEvent.submit(input.closest("form")!);

  expect(addGroceryItem).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Add to pantry · Peas" })).toBeInTheDocument();
  expect(screen.getByLabelText("Quantity")).toHaveValue(1);

  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "4" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect(addGroceryItem).toHaveBeenCalledWith({
      workspaceId: props.workspaceId, name: "Peas", category: "pantry", target: "stock", quantity: 4, expiresOn: null,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("heading", { name: /Add to pantry/ })).toBeNull());
  expect(input).toHaveValue("");
});

it("keeps the typed name when the pantry add dialog is cancelled", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} target="stock" />);
  const input = screen.getByRole("textbox", { name: /add an item/i });
  fireEvent.change(input, { target: { value: "Peas" } });
  fireEvent.submit(input.closest("form")!);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(addGroceryItem).not.toHaveBeenCalled();
  expect(input).toHaveValue("Peas");
});

// Regression: picking a suggestion used to submit whatever the selector held, so a Dairy item
// re-added this way silently became Pantry and lost its shelf-life estimate.
it("prefills the suggestion's own category in the pantry add dialog", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} target="stock" />);

  fireEvent.change(screen.getByRole("textbox", { name: /add an item/i }), {
    target: { value: "oat" },
  });
  fireEvent.click(screen.getByRole("button", { name: /oat milk/i }));
  expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("dairy");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(addGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Oat milk", category: "dairy" }),
    ),
  );
});

// Regression (Critical 1): a typed re-add of an existing Dairy item used to send "pantry" and
// rewrite the stored category. The dialog now shows the stored one for a matching name.
it("shows an existing product's stored category for a typed pantry add", () => {
  render(<AddRow {...props} target="stock" />);
  const input = screen.getByRole("textbox", { name: /add an item/i });
  fireEvent.change(input, { target: { value: " OAT MILK " } });
  fireEvent.submit(input.closest("form")!);
  expect(screen.getByRole("heading", { name: "Add to pantry · Oat milk" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("dairy");
});

it("sends the category the user picks in the pantry add dialog", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} target="stock" />);
  const input = screen.getByRole("textbox", { name: /add an item/i });
  fireEvent.change(input, { target: { value: "Peas" } });
  fireEvent.submit(input.closest("form")!);
  fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "frozen" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(addGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Peas", category: "frozen" }),
    ),
  );
});

it("sends no category on a typed shopping add", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} />);
  const input = screen.getByRole("textbox", { name: /add an item/i });

  fireEvent.change(input, { target: { value: "Oat milk" } });
  fireEvent.submit(input.closest("form")!);

  await waitFor(() => expect(addGroceryItem).toHaveBeenCalled());
  expect(jest.mocked(addGroceryItem).mock.calls[0][0]).not.toHaveProperty("category");
});

it("has no shopping category selector and suggestions do not send a category", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} />);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: /add an item/i }), { target: { value: "oat" } });
  fireEvent.click(screen.getByRole("button", { name: /oat milk/i }));
  await waitFor(() => expect(addGroceryItem).toHaveBeenCalled());
  expect(jest.mocked(addGroceryItem).mock.calls[0][0]).not.toHaveProperty("category");
});
