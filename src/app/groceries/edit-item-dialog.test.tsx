import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditItemDialog } from "./edit-item-dialog";
import { editItem, editLot } from "./actions";
import type { GroceryItem } from "./types";
jest.mock("./actions", () => ({ editItem: jest.fn(), editLot: jest.fn() }));
const item: GroceryItem = { id: "33333333-3333-4333-8333-333333333333", name: "Milk", category: "dairy", inStock: true, needed: false, quantity: null, expiresOn: "2026-09-13", expiryIsEstimate: true, timesAdded: 1, lotId: null };
const stocked: GroceryItem = { ...item, quantity: 2, lotId: "44444444-4444-4444-8444-444444444444" };
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; });
beforeEach(() => { jest.clearAllMocks(); jest.mocked(editItem).mockResolvedValue({ ok: true, itemId: item.id }); jest.mocked(editLot).mockResolvedValue({ ok: true }); });
it("edits product fields only when the item has no stock row", async () => {
  render(<EditItemDialog item={item} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(editItem).toHaveBeenCalledWith({ itemId: item.id, name: "Milk", category: "dairy" }));
  expect(screen.queryByLabelText(/Quantity/)).not.toBeInTheDocument();
  expect(editLot).not.toHaveBeenCalled();
});
it("edits quantity and expiry of a pantry item's stock", async () => {
  const close = jest.fn();
  render(<EditItemDialog item={stocked} onClose={close} />);
  expect(screen.getByLabelText("Quantity")).toHaveValue(2);
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2026-09-20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(editLot).toHaveBeenCalledWith({ lotId: stocked.lotId, quantity: 5, expiresOn: "2026-09-20", expiryIsEstimate: false });
});
it("keeps an untouched estimated date an estimate", async () => {
  render(<EditItemDialog item={stocked} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(editLot).toHaveBeenCalledWith({ lotId: stocked.lotId, quantity: 2, expiresOn: "2026-09-13", expiryIsEstimate: true }));
});
it("clears expiry, and saves a blank quantity as 1", async () => {
  render(<EditItemDialog item={stocked} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Expiry"), { target: { value: "none" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(editLot).toHaveBeenCalledWith({ lotId: stocked.lotId, quantity: 1, expiresOn: null, expiryIsEstimate: false }));
});
it("does not touch stock when the name save fails", async () => {
  jest.mocked(editItem).mockResolvedValue({ ok: false, error: "Name already exists" });
  render(<EditItemDialog item={stocked} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Name already exists");
  expect(editLot).not.toHaveBeenCalled();
});
it("shopping edit exposes only the name and preserves category and stock", async () => {
  render(<EditItemDialog shopping item={stocked} onClose={jest.fn()} />);
  expect(screen.queryByLabelText("Quantity")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(editItem).toHaveBeenCalledWith({ itemId: item.id, name: "Milk" }));
});
it("keeps errors inside the dialog and retains entered values", async () => {
  jest.mocked(editItem).mockResolvedValue({ ok: false, error: "Name already exists" });
  render(<EditItemDialog item={item} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Cream" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Name already exists");
  expect(screen.getByLabelText("Name")).toHaveValue("Cream");
});
it("shows rejected requests in the dialog", async () => {
  jest.mocked(editItem).mockRejectedValueOnce(new Error("offline"));
  render(<EditItemDialog item={item} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
});
