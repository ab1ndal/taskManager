import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditItemDialog } from "./edit-item-dialog";
import { editItem } from "./actions";
import type { GroceryItem } from "./types";
jest.mock("./actions", () => ({ editItem: jest.fn() }));
const item: GroceryItem = { id: "33333333-3333-4333-8333-333333333333", name: "Milk", category: "dairy", inStock: true, needed: false, quantity: null, expiresOn: "2026-09-13", expiryIsEstimate: true, timesAdded: 1 , lots: []};
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; });
beforeEach(() => { jest.clearAllMocks(); jest.mocked(editItem).mockResolvedValue({ ok: true, itemId: item.id }); });
it("edits product fields without restating stock", async () => {
  render(<EditItemDialog item={item} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(editItem).toHaveBeenCalledWith({ itemId: item.id, name: "Milk", category: "dairy" }));
  expect(screen.queryByLabelText(/Quantity/)).not.toBeInTheDocument();
});
it("shopping edit exposes only the name and preserves category", async () => {
  render(<EditItemDialog shopping item={item} onClose={jest.fn()} />);
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
