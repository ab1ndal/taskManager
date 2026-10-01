import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PurchaseDialog } from "./purchase-dialog";
import { markBought } from "./actions";
import type { GroceryItem } from "./types";
jest.mock("./actions", () => ({ markBought: jest.fn() }));
const item: GroceryItem = { id: "33333333-3333-4333-8333-333333333333", name: "Milk", category: "dairy", inStock: true, needed: true, quantity: 2, expiresOn: "2026-09-12", expiryIsEstimate: false, timesAdded: 1, lotId: null };
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; });
beforeEach(() => { jest.clearAllMocks(); jest.mocked(markBought).mockResolvedValue({ ok: true, itemId: item.id }); });
it("prefills a quantity of 1", async () => {
  render(<PurchaseDialog item={item} onClose={jest.fn()} />);
  expect(screen.getByLabelText("Quantity")).toHaveValue(1);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(markBought).toHaveBeenCalledWith({ itemId: item.id, quantity: 1, expiresOn: null }));
});
it("records a purchase with a typed count and a printed date, then closes", async () => {
  const close = jest.fn();
  render(<PurchaseDialog item={item} onClose={close} />);
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Expiry"), { target: { value: "date" } });
  fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2026-09-20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(markBought).toHaveBeenCalledWith({ itemId: item.id, quantity: 3, expiresOn: "2026-09-20" });
});
it("sends no quantity when the field is cleared, which the database counts as 1", async () => {
  render(<PurchaseDialog item={item} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(markBought).toHaveBeenCalledWith({ itemId: item.id, quantity: null, expiresOn: null }));
});
it("no longer offers to add another batch", () => {
  render(<PurchaseDialog item={item} onClose={jest.fn()} />);
  expect(screen.queryByRole("button", { name: /another batch/ })).toBeNull();
});
it("retains input and shows request failures inside the dialog", async () => {
  jest.mocked(markBought).mockRejectedValueOnce(new Error("offline"));
  render(<PurchaseDialog item={item} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  expect(screen.getByLabelText("Quantity")).toHaveValue(3);
});
