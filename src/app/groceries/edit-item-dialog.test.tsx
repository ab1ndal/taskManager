import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditItemDialog } from "./edit-item-dialog";
import { editItem } from "./actions";
import type { GroceryItem } from "./types";
jest.mock("./actions", () => ({ editItem: jest.fn() }));
const item: GroceryItem = { id: "33333333-3333-4333-8333-333333333333", name: "Milk", category: "dairy", inStock: true, needed: false, quantity: null, expiresOn: "2026-09-13", expiryIsEstimate: true, timesAdded: 1 };
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; });
beforeEach(() => { jest.clearAllMocks(); jest.mocked(editItem).mockResolvedValue({ ok: true, itemId: item.id }); });
it("sets a quantity and preserves an unchanged estimate", async () => {
  const close = jest.fn();
  render(<EditItemDialog item={item} onClose={close} />);
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(editItem).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3, expiryIsEstimate: true }));
});
it("clears quantity and expiry", async () => {
  render(<EditItemDialog item={{ ...item, quantity: 3 }} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(editItem).toHaveBeenCalledWith(expect.objectContaining({ quantity: null, expiresOn: null, expiryIsEstimate: false })));
});
it("keeps errors inside the dialog and retains entered values", async () => {
  jest.mocked(editItem).mockResolvedValue({ ok: false, error: "Name already exists" });
  render(<EditItemDialog item={item} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Cream" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Name already exists");
  expect(screen.getByLabelText("Name")).toHaveValue("Cream");
});
it("only edits descriptive fields on an out-of-stock item", async () => {
  render(<EditItemDialog item={{ ...item, inStock: false, expiresOn: null }} onClose={jest.fn()} />);
  expect(screen.queryByLabelText("Quantity")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Expiry date")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(editItem).toHaveBeenCalledWith(expect.objectContaining({ quantity: null, expiresOn: null })));
});

it("marks a changed printed date as explicit", async () => {
  render(<EditItemDialog item={item} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2026-09-20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(editItem).toHaveBeenCalledWith(expect.objectContaining({ expiresOn: "2026-09-20", expiryIsEstimate: false })));
});
it("shows rejected requests in the dialog", async () => {
  jest.mocked(editItem).mockRejectedValueOnce(new Error("offline"));
  render(<EditItemDialog item={item} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
});
