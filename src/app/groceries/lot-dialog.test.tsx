import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LotDialog } from "./lot-dialog";
import { editLot, markBought } from "./actions";
import type { GroceryItem, GroceryLot } from "./types";
jest.mock("./actions", () => ({ editLot: jest.fn(), markBought: jest.fn() }));
const item: GroceryItem = { id: "33333333-3333-4333-8333-333333333333", name: "Milk", category: "dairy", inStock: true, needed: true, quantity: 2, expiresOn: "2026-09-12", expiryIsEstimate: false, timesAdded: 1, lots: [] };
const lot: GroceryLot = { id: "44444444-4444-4444-8444-444444444444", itemId: item.id, quantity: 2, expiresOn: "2026-09-12", expiryIsEstimate: true, createdAt: "2026-09-07T12:00:00Z" };
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; });
beforeEach(() => { jest.clearAllMocks(); jest.mocked(editLot).mockResolvedValue({ ok: true }); jest.mocked(markBought).mockResolvedValue({ ok: true, itemId: item.id }); });
it("records a purchase with optional count and no expiry", async () => {
  render(<LotDialog item={item} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(markBought).toHaveBeenCalledWith({ itemId: item.id, quantity: 3, expiresOn: null }));
});
it("keeps purchase entry open to record a second expiry within the same trip", async () => {
  const close = jest.fn();
  render(<LotDialog item={item} onClose={close} />);
  fireEvent.change(screen.getByLabelText("Expiry"), { target: { value: "date" } });
  fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2026-09-20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and add another batch" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Batch saved");
  expect(close).not.toHaveBeenCalled();
  expect(markBought).toHaveBeenCalledWith({ itemId: item.id, quantity: null, expiresOn: "2026-09-20" });
});
it("edits one batch and preserves an unchanged estimate", async () => {
  render(<LotDialog item={item} lot={lot} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(editLot).toHaveBeenCalledWith({ lotId: lot.id, quantity: 4, expiresOn: lot.expiresOn, expiryIsEstimate: true }));
});
it("clears expiry without changing other batches", async () => {
  render(<LotDialog item={item} lot={lot} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Expiry"), { target: { value: "none" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(editLot).toHaveBeenCalledWith({ lotId: lot.id, quantity: 2, expiresOn: null, expiryIsEstimate: false }));
});
it("retains input and shows request failures inside the dialog", async () => {
  jest.mocked(markBought).mockRejectedValueOnce(new Error("offline"));
  render(<LotDialog item={item} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  expect(screen.getByLabelText(/Quantity/)).toHaveValue(3);
});
